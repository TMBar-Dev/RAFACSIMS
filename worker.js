// Cloudflare Worker entry point: API requests use D1; other requests serve the
// generated frontend through ASSETS. Never serve the repository root itself.
import { MANAGEMENT_SCHEMA } from './schema.js';

const encoder = new TextEncoder();
// Keep this compatible with stored PBKDF2 records and the Workers runtime.
const ITERATIONS = 100000;
const SESSION_SECONDS = 86400;
// __Host- cookies require HTTPS, Secure, Path=/ and no Domain attribute.
const COOKIE = '__Host-rafacsims';
// Bootstrap record only. INSERT OR IGNORE below preserves an admin password
// that has already been changed; this hash is not written over existing users.
const ADMIN_HASH = 'pbkdf2$100000$475004062412af7965037c5326040053$ca2fda7f770b4c51d1b36f487286026209645347a4ef2bfd2a9b4ec29ba199ed';
// Shared by requests in this Worker isolate, not a replacement for D1 storage.
let ready;

// CREATE IF NOT EXISTS and INSERT OR IGNORE also make cold-start races safe.
// Concurrent requests share the initialization promise; a failure permits retry.
async function initialize(db) {
  if (!ready) ready = db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )`),
    // Add the management tables without changing existing authentication
    // records. Staff profiles can link to accounts through user_id.
    ...MANAGEMENT_SCHEMA.map(statement => db.prepare(statement)),
    db.prepare(`INSERT OR IGNORE INTO users
      (username, password_hash, role, must_change_password) VALUES ('admin', ?, 'admin', 1)`)
      .bind(ADMIN_HASH),
    // Include the existing bootstrap administrator in the staff directory. This
    // only inserts a missing profile: its password, role and existing profile
    // details are never replaced on deployment or a Worker cold start.
    db.prepare(`INSERT OR IGNORE INTO staff (user_id, first_name, last_name)
      SELECT id, '-', '-'
      FROM users WHERE username = 'admin' AND role = 'admin'`)
  ]).catch(error => { ready = undefined; throw error; });
  await ready;
}

function json(body, status = 200, headers = {}) {
  // Session and account responses must not be reused by browser/CDN caches.
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function hex(bytes) {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function randomToken() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
// Stored format: algorithm$iterations$salt$hash. Salt is encoded as UTF-8 text,
// matching existing records; decoding it as raw hex would change password hashes.
async function hashPassword(password, salt = randomToken()) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256',
    salt: encoder.encode(salt), iterations: ITERATIONS }, key, 256);
  return `pbkdf2$${ITERATIONS}$${salt}$${hex(bits)}`;
}
async function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2' || Number(parts[1]) !== ITERATIONS) return false;
  const actual = await hashPassword(password, parts[2]);
  if (actual.length !== stored.length) return false;
  // Compare the whole equal-length string rather than exit on a first mismatch.
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ stored.charCodeAt(i);
  return difference === 0;
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128)
    fail('Choose a password between 12 and 128 characters.');
}
function publicUser(user) {
  // Explicit allowlist: never send password hashes or session records to clients.
  return { username: user.username, role: user.role, mustChangePassword: Boolean(user.must_change_password) };
}
function publicStaff(row) {
  return {
    id: row.id,
    account: row.account_id === null ? null : { id: row.account_id, ...publicUser(row) }
  };
}
// Existing D1 tables require nonempty name columns. Fixed markers keep staff
// IDs and order references intact while allowing links without personal data.
const INSERT_STAFF_LINK = `INSERT INTO staff (user_id, first_name, last_name)
  SELECT id, '-', '-' FROM users WHERE username = ?`;
function requireAdministrator(user) {
  // Use the current D1 user row from the session lookup, never a browser-supplied
  // role. A first-login password change is required before account management.
  if (!user) fail('Please log in.', 401);
  if (user.must_change_password) fail('Change your password before continuing.', 403);
  if (user.role !== 'admin') fail('Administrator access is required.', 403);
}
function cookie(token, seconds = SESSION_SECONDS) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
}
async function currentSession(request, db) {
  // The browser holds the random token; D1 holds only its SHA-256 digest.
  // Join to the current user row so role/password-change status stays current.
  const token = (request.headers.get('Cookie') || '').split(';').map(v => v.trim())
    .find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare(`SELECT users.*, sessions.token_hash FROM sessions
    JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?`)
    .bind(await digest(token), Math.floor(Date.now() / 1000)).first();
}
async function issueSession(db, userId) {
  // Expiry is enforced in D1 lookups as well as by the browser cookie lifetime.
  const token = randomToken();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await digest(token), userId, Math.floor(Date.now() / 1000) + SESSION_SECONDS).run();
  return token;
}

async function api(request, env) {
  const path = new URL(request.url).pathname;
  if (!['GET', 'POST'].includes(request.method)) return json({ message: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
  if (request.method === 'POST') {
    // State changes accept only same-origin JSON requests. Browser fetch sets
    // Origin automatically; scripted clients must supply a matching header.
    if (request.headers.get('Origin') !== new URL(request.url).origin) fail('Request origin rejected.', 403);
    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) fail('JSON required.', 415);
  }
  if (!env.DB) fail('Database binding DB is not configured.', 503);
  await initialize(env.DB);
  if (request.method === 'GET' && path === '/api/session') {
    // Signed-out users get null, allowing the frontend to restore state on load.
    const user = await currentSession(request, env.DB);
    return json({ user: user ? publicUser(user) : null });
  }
  if (request.method === 'GET' && path === '/api/users') {
    requireAdministrator(await currentSession(request, env.DB));
    // ID-based cursors keep pages stable when new accounts are added. Fetch one
    // extra row to detect another page without returning an unbounded user list.
    const cursor = new URL(request.url).searchParams.get('after') ?? '0';
    if (!/^\d{1,16}$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) fail('Invalid user-list cursor.');
    const result = await env.DB.prepare(`SELECT id, username, role, must_change_password, created_at
      FROM users WHERE id > ? ORDER BY id ASC LIMIT 26`).bind(Number(cursor)).all();
    const users = result.results.slice(0, 25).map(row => ({
      id: row.id,
      ...publicUser(row),
      createdAt: row.created_at
    }));
    // Only the explicitly selected public fields leave the Worker. Password
    // hashes and session tokens are neither queried nor exposed by this endpoint.
    return json({ users, nextCursor: result.results.length > 25 ? users[users.length - 1].id : null });
  }
  if (request.method === 'GET' && path === '/api/staff') {
    requireAdministrator(await currentSession(request, env.DB));
    const cursor = new URL(request.url).searchParams.get('after') ?? '0';
    if (!/^\d{1,16}$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) fail('Invalid staff-list cursor.');
    // LEFT JOIN retains existing profiles without a login. Authorization uses
    // the requesting administrator's current session, never a listed role.
    const result = await env.DB.prepare(`SELECT s.id, u.id AS account_id, u.username, u.role, u.must_change_password
      FROM staff s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.id > ? ORDER BY s.id ASC LIMIT 26`).bind(Number(cursor)).all();
    const staff = result.results.slice(0, 25).map(publicStaff);
    return json({ staff, nextCursor: result.results.length > 25 ? staff[staff.length - 1].id : null });
  }
  if (request.method !== 'POST') return json({ message: 'Not found.' }, 404);
  if (Number(request.headers.get('Content-Length')) > 4096) fail('Request too large.', 413);
  const text = await request.text();
  if (text.length > 4096) fail('Request too large.', 413);
  let body;
  try { body = JSON.parse(text); } catch { fail('Invalid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Invalid request.');

  // Cloudflare provides CF-Connecting-IP; all auth writes share a 20/minute budget.
  const now = Math.floor(Date.now() / 1000);
  const bucket = await digest(`${request.headers.get('CF-Connecting-IP') || 'local'}:${Math.floor(now / 60)}`);
  const limits = await env.DB.batch([
    env.DB.prepare(`INSERT INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1 RETURNING hits`).bind(bucket, now + 120),
    env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now)
  ]);
  if (limits[0].results[0].hits > 20) return json({ message: 'Too many requests. Try again in a minute.' }, 429, { 'Retry-After': '60' });

  if (path === '/api/register') {
    // Usernames are unique ignoring case. Role defaults to user in the schema;
    // no role supplied by a registration request is accepted.
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) fail('Username must contain 3–40 letters, numbers, dots, underscores or hyphens.');
    if (username.toLowerCase() === 'admin') fail('That username is reserved.', 409);
    validatePassword(body.password);
    const result = await env.DB.prepare('INSERT OR IGNORE INTO users (username, password_hash) VALUES (?, ?)')
      .bind(username, await hashPassword(body.password)).run();
    if (!result.meta.changes) fail('That username is already registered.', 409);
    return json({ message: 'Account created. You can now log in.' }, 201);
  }
  if (path === '/api/login') {
    if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.password.length > 128) fail('Incorrect username or password.', 401);
    const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(body.username.trim()).first();
    // Do the same password work when an account does not exist.
    const valid = await verifyPassword(body.password, user?.password_hash || ADMIN_HASH);
    if (!user || !valid) fail('Incorrect username or password.', 401);
    const token = await issueSession(env.DB, user.id);
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Math.floor(Date.now() / 1000)).run();
    return json({ user: publicUser(user) }, 200, { 'Set-Cookie': cookie(token) });
  }

  const user = await currentSession(request, env.DB);
  if (!user) fail('Please log in.', 401);
  // These maintenance actions remain available during mandatory password reset.
  if (path === '/api/logout') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.token_hash).run();
    return json({ message: 'Logged out.' }, 200, { 'Set-Cookie': cookie('', 0) });
  }
  if (path === '/api/change-password') {
    if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 128 ||
      !await verifyPassword(body.currentPassword, user.password_hash)) fail('Current password is incorrect.', 403);
    validatePassword(body.newPassword);
    if (body.newPassword === body.currentPassword || body.newPassword === 'RAFACSIMS') fail('Choose a different password.');
    const hash = await hashPassword(body.newPassword);
    const token = randomToken();
    // D1 executes this batch transactionally. Guard against concurrent changes
    // using a stale password, revoke all old sessions and issue one fresh token.
    const results = await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND password_hash = ?')
        .bind(hash, user.id, user.password_hash),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)')
        .bind(user.id, user.id, hash),
      env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at)
        SELECT ?, id, ? FROM users WHERE id = ? AND password_hash = ?`)
        .bind(await digest(token), Math.floor(Date.now() / 1000) + SESSION_SECONDS, user.id, hash)
    ]);
    if (!results[0].meta.changes) fail('Your password has changed. Please log in again.', 409);
    return json({ user: { ...publicUser(user), mustChangePassword: false } }, 200, { 'Set-Cookie': cookie(token) });
  }
  // All future protected endpoints must sit behind this gate.
  if (user.must_change_password) fail('Change your password before continuing.', 403);
  if (path === '/api/staff') {
    requireAdministrator(user);
    const accountMode = body.accountMode === undefined ? 'create' : body.accountMode;
    if (!['create', 'existing'].includes(accountMode)) fail('Choose whether to create or link a login.');
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) fail('Username must contain 3-40 letters, numbers, dots, underscores or hyphens.');
    let passwordHash;
    if (accountMode === 'create') {
      if (username.toLowerCase() === 'admin') fail('That username is reserved.', 409);
      if (!['user', 'admin'].includes(body.role)) fail('Choose a valid account role.');
      validatePassword(body.password);
      passwordHash = await hashPassword(body.password);
    }
    try {
      if (accountMode === 'create') {
        // A plain INSERT plus one D1 batch makes profile/account creation atomic.
        // If either unique key conflicts, the new login is rolled back as well.
        // Select its ID by unique username instead of relying on connection-local
        // last_insert_rowid() state across separate D1 statements.
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO users (username, password_hash, role, must_change_password)
            VALUES (?, ?, ?, 1)`).bind(username, passwordHash, body.role),
          env.DB.prepare(INSERT_STAFF_LINK).bind(username)
        ]);
      } else {
        // Link from the current account row in one statement.
        const result = await env.DB.prepare(INSERT_STAFF_LINK).bind(username).run();
        if (!result.meta.changes) fail('No user account matches that username.', 404);
      }
    } catch (error) {
      const details = [error.message, error.cause?.message].filter(Boolean).join(' ');
      if (/UNIQUE constraint failed:\s*(?:users\.username|staff\.user_id)/i.test(details))
        fail('That username already exists or the login is already linked to staff.', 409);
      throw error;
    }
    return json({ message: accountMode === 'create'
      ? 'Staff account created. The user must change their temporary password on first login.'
      : 'Existing login linked to Staff Accounts.' }, 201);
  }
  if (path === '/api/users') {
    requireAdministrator(user);
    // Account creation shares the existing JSON/origin/body/rate-limit guards.
    // Only authenticated administrators may choose a role; public registration
    // above continues to create ordinary users regardless of request contents.
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) fail('Username must contain 3-40 letters, numbers, dots, underscores or hyphens.');
    if (username.toLowerCase() === 'admin') fail('That username is reserved.', 409);
    if (!['user', 'admin'].includes(body.role)) fail('Choose a valid account role.');
    validatePassword(body.password);
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO users
      (username, password_hash, role, must_change_password) VALUES (?, ?, ?, 1)`)
      .bind(username, await hashPassword(body.password), body.role).run();
    if (!result.meta.changes) fail('That username is already registered.', 409);
    // Do not sign in as the new account or return its temporary password. The
    // existing administrator session remains active after creating an account.
    return json({ message: 'Account created. The user must change their temporary password on first login.' }, 201);
  }
  return json({ message: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return await api(request, env); }
    catch (error) {
      // Expected validation errors are safe to display. Internal SQL/runtime
      // details stay in Worker logs rather than leaking through API responses.
      if (!error.status) console.error('API error', error);
      return json({ message: error.status ? error.message : 'The service is temporarily unavailable. Please try again.' }, error.status || 503);
    }
  }
};
