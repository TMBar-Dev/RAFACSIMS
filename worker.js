// Cloudflare Worker entry point: API requests use D1; other requests serve the
// generated frontend through ASSETS. Never serve the repository root itself.
import { loginLimits, networkKey } from './login-limits.js';
import { MANAGEMENT_SCHEMA } from './schema.js';
import { initializeStaffSchema } from './staff-schema.js';
import {
  ALL_PERMISSIONS, ISSUE_KIT, RETURN_KIT, STORES_DEMANDS, hasPermission, permissionMask, permissionNames
} from './account-permissions.js';
import { fail, managementRoute, readManagement, writeManagement } from './management.js';
import { inventoryRoute, readInventory, writeInventory } from './inventory.js';
import { ACCOUNT_ACTIVE, ACCOUNT_ADMIN_SCHEMA, LIVE_ADMIN, VERIFIED_CREDENTIALS, administerAccount, securityEvent } from './account-admin.js';
import {
  BRANDING_SCHEMA, brandingBodyLimit, brandingImageSlot, readAbout, readBranding, readBrandingUpload as readBoundedBody,
  saveBranding, saveBrandingImage, serveBrandingImage
} from './branding.js';

const encoder = new TextEncoder();
// Keep this compatible with stored PBKDF2 records and the Workers runtime.
const ITERATIONS = 100000;
const SESSION_SECONDS = 86400;
// __Host- cookies require HTTPS, Secure, Path=/ and no Domain attribute.
const COOKIE = '__Host-rafacsims';
// Block the retired public administrator credential and sessions tied to it.
const RETIRED_ADMIN_HASH = 'pbkdf2$100000$475004062412af7965037c5326040053$ca2fda7f770b4c51d1b36f487286026209645347a4ef2bfd2a9b4ec29ba199ed';
// Shared by requests in this Worker isolate, not a replacement for D1 storage.
let ready;

// Concurrent requests share the initialization promise; a failure permits retry.
async function initialize(db) {
  if (!ready) ready = initializeDatabase(db).catch(error => { ready = undefined; throw error; });
  await ready;
}

async function initializeDatabase(db) {
  // Create the marker last in the same batch so failed or partial migrations are retried.
  const migrated = await db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_ready_20261119'").first();
  if (migrated) return;
  await initializeStaffSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS session_activity (
      token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
      last_active INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS start_session_activity AFTER INSERT ON sessions
      BEGIN INSERT INTO session_activity VALUES (NEW.token_hash, unixepoch()); END`),
    db.prepare(`INSERT OR IGNORE INTO session_activity (token_hash, last_active)
      SELECT token_hash, expires_at - 86400 FROM sessions`),
    db.prepare('CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )`),
    ...ACCOUNT_ADMIN_SCHEMA.map(statement => db.prepare(statement)),
    ...BRANDING_SCHEMA.map(statement => db.prepare(statement)),
    ...MANAGEMENT_SCHEMA.map(statement => db.prepare(statement)),
    db.prepare('CREATE TABLE IF NOT EXISTS schema_ready_20261119 (id INTEGER PRIMARY KEY)')
  ]);
}

function json(body, status = 200, headers = {}) {
  // Session and account responses must not be reused by browser/CDN caches.
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex', ...headers } });
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
function validatePassword(password, username) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 128)
    fail('Choose a password between 6 and 128 characters.');
  const normalized = password.trim().toLowerCase();
  if (normalized.length < 6 || normalized === username.toLowerCase() ||
      /^(?:rafacsims|password[0-9]*|123456(?:7890?)?|qwerty[0-9]*|abcde[1f]|letmein|admin[0-9]*|(.)\1+)$/.test(normalized))
    fail('Choose a less predictable password.');
}
function publicUser(user) {
  // Explicit allowlist: never send password hashes or session records to clients.
  return { username: user.username, role: user.role, mustChangePassword: Boolean(user.must_change_password) };
}
const INSERT_ADMIN_CREATED_USER = `INSERT INTO staff (username, password_hash, role, must_change_password, permissions)
  SELECT ?, ?, ?, 1, ? WHERE ${LIVE_ADMIN}`;

function requireReadySession(user) {
  if (!user) fail('Please log in.', 401);
  if (user.must_change_password) fail('Change your password before continuing.', 403);
}
function requireAdministrator(user) {
  requireReadySession(user);
  if (user.role !== 'admin') fail('Administrator access is required.', 403);
}
function requireOperationalAccess(user, permission) {
  requireReadySession(user);
  if (!hasPermission(user, permission)) fail('Stores permission is required.', 403);
}

const inventoryPermissions = new Map([
  ['receipts', STORES_DEMANDS], ['back-orders', STORES_DEMANDS], ['purchase-orders', STORES_DEMANDS],
  ['issues', ISSUE_KIT], ['cadet-kit', ISSUE_KIT], ['supplier-returns', RETURN_KIT]
]);

function cookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict${token ? '' : '; Max-Age=0'}`;
}
async function currentSession(request, db) {
  // The browser holds the random token; D1 holds only its SHA-256 digest.
  // Join to the current user row so role/password-change status stays current.
  const token = (request.headers.get('Cookie') || '').split(';').map(v => v.trim())
    .find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const now = Math.floor(Date.now() / 1000);
  const user = await db.prepare(`SELECT staff.*, sessions.token_hash, session_activity.last_active FROM sessions
    JOIN staff ON staff.id = sessions.user_id
    JOIN session_activity ON session_activity.token_hash = sessions.token_hash
    WHERE sessions.token_hash = ? AND expires_at > ? AND last_active > ? AND password_hash != ? AND ${ACCOUNT_ACTIVE}`)
    .bind(await digest(token), now, now - 1800, RETIRED_ADMIN_HASH).first();
  // Background session and permissions checks must never keep an idle tab signed in.
  const path = new URL(request.url).pathname;
  if (user && user.last_active <= now - 60 && path !== '/api/session' && path !== '/api/operations/access') {
    const updated = await db.prepare('UPDATE session_activity SET last_active = ? WHERE token_hash = ? AND last_active > ?')
      .bind(now, user.token_hash, now - 1800).run();
    if (!updated.meta.changes) return null;
  }
  return user;
}
async function issueSession(db, user) {
  const token = randomToken();
  // Compare the verified account state at insertion so a concurrent password
  // reset, deactivation or identity edit cannot create a stale session.
  const [result] = await db.batch([db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at)
    SELECT ?, id, ? FROM staff WHERE id = ? AND password_hash = ? AND username COLLATE BINARY = ?
      AND role = ? AND must_change_password = ? AND ${ACCOUNT_ACTIVE}`)
    .bind(await digest(token), Math.floor(Date.now() / 1000) + SESSION_SECONDS,
      user.id, user.password_hash, user.username, user.role, user.must_change_password),
    securityEvent(db, user.id, user.id, 'session.sign-in')]);
  if (!result.meta.changes) fail('Incorrect username or password.', 401);
  return token;
}

async function api(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const management = managementRoute(path);
  const inventory = inventoryRoute(path);
  const imageSlot = brandingImageSlot(path);
  const accountAction = /^\/api\/(?:users|staff)\/(\d+)\/(edit|reset-password|deactivate|reactivate)$/.exec(path);
  if (!['GET', 'POST'].includes(request.method)) return json({ message: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
  if (request.method === 'POST') {
    // State changes accept only same-origin JSON requests. Browser fetch sets
    // Origin automatically; scripted clients must supply a matching header.
    if (request.headers.get('Origin') !== new URL(request.url).origin) fail('Request origin rejected.', 403);
    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) fail('JSON required.', 415);
  }
  if (!env.DB) fail('Database binding DB is not configured.', 503);
  await initialize(env.DB);
  if (request.method === 'GET') {
    if (path === '/api/branding') return json(await readBranding(env.DB), 200, { 'Cache-Control': 'public, max-age=60' });
    if (imageSlot) {
      const revision = url.searchParams.get('v');
      const cache = ctx && globalThis.caches?.default;
      if (!cache || !/^[a-f0-9-]{36}$/i.test(revision ?? '')) return serveBrandingImage(env.DB, imageSlot, revision);
      // Use the revision alone so unrelated query parameters do not split the cache.
      const key = new Request(url.origin + path + '?v=' + revision);
      const stored = await cache.match(key);
      if (stored) return stored;
      const image = await serveBrandingImage(env.DB, imageSlot, revision);
      ctx.waitUntil(cache.put(key, image.clone()).catch(error => console.warn('Branding cache write failed', error.message)));
      return image;
    }
    if (path === '/api/security-events') {
      requireAdministrator(await currentSession(request, env.DB));
      const { results } = await env.DB.prepare('SELECT id, actor_id, target_id, action, summary, created_at FROM security_events ORDER BY id DESC LIMIT 50').all();
      return json({ events: results });
    }
    if (path === '/api/settings') {
      requireAdministrator(await currentSession(request, env.DB));
      return json(await readBranding(env.DB, true));
    }
    if (path === '/api/about') {
      requireReadySession(await currentSession(request, env.DB));
      return json(await readAbout(env.DB));
    }
  }
  if (request.method === 'GET' && path === '/api/session') {
    // Signed-out users get null, allowing the frontend to restore state on load.
    const user = await currentSession(request, env.DB);
    return json(user ? { user: publicUser(user), idleExpiresAt: user.last_active + 1800 } : { user: null });
  }
  if (request.method === 'GET' && path === '/api/operations/access') {
    const user = await currentSession(request, env.DB);
    requireOperationalAccess(user);
    return json({ canOperate: true, permissions: permissionNames(user.role === 'admin' ? ALL_PERMISSIONS : user.permissions) });
  }
  if (request.method === 'GET' && management) {
    const user = await currentSession(request, env.DB);
    const permission = management.resource === 'purchase-orders' ? STORES_DEMANDS
      : management.resource === 'cadets' ? ISSUE_KIT : undefined;
    requireOperationalAccess(user, permission);
    return json(await readManagement(env.DB, management, url, user));
  }
  if (request.method === 'GET' && inventory) {
    const user = await currentSession(request, env.DB);
    if (inventory.resource === 'opening-balances' || inventory.workflow === 'opening-balances') requireAdministrator(user);
    else requireOperationalAccess(user, inventoryPermissions.get(inventory.workflow ?? inventory.resource));
    return json(await readInventory(env.DB, inventory, url, user));
  }
  if (request.method === 'GET' && (path === '/api/users' || path === '/api/staff')) {
    requireAdministrator(await currentSession(request, env.DB));
    const cursor = url.searchParams.get('after') ?? '0';
    if (!/^\d{1,16}$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) fail('Invalid account-list cursor.');
    // Explicitly select public fields. The legacy envelopes now read the same account table.
    const result = await env.DB.prepare(`SELECT id, username, role, must_change_password, permissions, created_at,
      (${ACCOUNT_ACTIVE}) AS active FROM staff WHERE id > ? ORDER BY id ASC LIMIT 26`).bind(Number(cursor)).all();
    const accounts = result.results.slice(0, 25).map(row => ({
      id: row.id,
      ...publicUser(row),
      active: Boolean(row.active),
      createdAt: row.created_at,
      permissions: permissionNames(row.permissions)
    }));
    const nextCursor = result.results.length > 25 ? accounts.at(-1).id : null;
    if (path === '/api/staff') return json({ staff: accounts.map(account => ({ id: account.id, account })), nextCursor });
    return json({ users: accounts, nextCursor });
  }
  if (request.method !== 'POST') return json({ message: 'Not found.' }, 404);
  let uploadActor;
  if (imageSlot) {
    // Authenticate before buffering the larger image body.
    uploadActor = await currentSession(request, env.DB);
    requireAdministrator(uploadActor);
  }
  const bodyLimit = imageSlot ? brandingBodyLimit(imageSlot) : management || inventory || path === '/api/settings' ? 32768 : 4096;
  if (Number(request.headers.get('Content-Length')) > bodyLimit) fail('The request exceeds the byte limit. Shorten large text fields and retry.', 413);
  const now = Math.floor(Date.now() / 1000);
  const user = path === '/api/login' ? null : uploadActor ?? await currentSession(request, env.DB);
  // Authenticated writers have their own budgets on shared squadron networks.
  if (user) {
    const bucket = await digest(`write:${user.id}:${Math.floor(now / 60)}`);
    const limits = await env.DB.batch([
      env.DB.prepare(`INSERT INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?)
        ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1 RETURNING hits`).bind(bucket, now + 120),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now)
    ]);
    if (limits[0].results[0].hits > 60) return json({ message: 'Too many requests. Try again in a minute.' }, 429, { 'Retry-After': '60' });
  }
  const text = await readBoundedBody(request, bodyLimit);
  let body;
  try { body = JSON.parse(text); } catch { fail('Invalid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Invalid request.');

  if (path === '/api/register') fail('Ask an administrator to create your account.', 410);
  if (path === '/api/login') {
    if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.password.length > 128) fail('Incorrect username or password.', 401);
    const username = body.username.trim();
    const keys = await Promise.all([digest(`login-network:${networkKey(request.headers.get('CF-Connecting-IP'))}`), digest(`login-account:${username.toLowerCase().slice(0, 40)}`)]);
    const limiter = loginLimits(env.DB, keys, now);
    const attempt = await limiter.reserve();
    if (attempt.retryAfter) return json({ message: 'Too many sign-in attempts. Try again shortly.' }, 429, { 'Retry-After': String(attempt.retryAfter) });
    const user = await env.DB.prepare(`SELECT * FROM staff
      WHERE username = ? AND password_hash != ? AND ${ACCOUNT_ACTIVE}`)
      .bind(username, RETIRED_ADMIN_HASH).first();
    // Do the same password work when an account does not exist.
    // Workers only allow random values inside a request, not at module load.
    const hash = user?.password_hash ?? `pbkdf2$${ITERATIONS}$${randomToken()}$${'0'.repeat(64)}`;
    const valid = await verifyPassword(body.password, hash);
    if (!user || !valid) fail('Incorrect username or password.', 401);
    await limiter.succeeded(attempt.expiresAt);
    const token = await issueSession(env.DB, user);
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Math.floor(Date.now() / 1000)).run();
    return json({ user: publicUser(user) }, 200, { 'Set-Cookie': cookie(token) });
  }

  // These maintenance actions remain available during mandatory password reset.
  if (path === '/api/logout') {
    if (user) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.token_hash).run();
    return json({ message: 'Logged out.' }, 200, { 'Set-Cookie': cookie('') });
  }
  if (!user) fail('Please log in.', 401);
  if (path === '/api/change-password') {
    if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 128 ||
      !await verifyPassword(body.currentPassword, user.password_hash)) fail('Current password is incorrect.', 403);
    validatePassword(body.newPassword, user.username);
    if (body.newPassword === body.currentPassword || body.newPassword === 'RAFACSIMS') fail('Choose a different password.');
    const hash = await hashPassword(body.newPassword);
    const token = randomToken();
    // D1 executes this batch transactionally. Guard against concurrent changes
    // using a stale password, revoke all old sessions and issue one fresh token.
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE staff SET password_hash = ?, must_change_password = 0 WHERE id = ? AND password_hash = ?
        AND ${ACCOUNT_ACTIVE} AND EXISTS (SELECT 1 FROM sessions WHERE token_hash = ? AND user_id = staff.id AND expires_at > unixepoch())`)
        .bind(hash, user.id, user.password_hash, user.token_hash),
      securityEvent(env.DB, user.id, user.id, 'account.change-password'),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM staff WHERE id = ? AND password_hash = ?)')
        .bind(user.id, user.id, hash),
      env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at)
        SELECT ?, id, ? FROM staff WHERE id = ? AND password_hash = ?`)
        .bind(await digest(token), Math.floor(Date.now() / 1000) + SESSION_SECONDS, user.id, hash)
    ]);
    if (!results[0].meta.changes) fail('Your password or session changed. Please log in again.', 409);
    return json({ user: { ...publicUser(user), mustChangePassword: false } }, 200, { 'Set-Cookie': cookie(token) });
  }
  // All future protected endpoints must sit behind this gate.
  if (user.must_change_password) fail('Change your password before continuing.', 403);
  if (imageSlot || path === '/api/settings' || accountAction) {
    requireAdministrator(user);
    if (imageSlot) return json(await saveBrandingImage(env.DB, user, imageSlot, body));
    if (path === '/api/settings') return json(await saveBranding(env.DB, user, body));
    return json(await administerAccount(env.DB, user, accountAction[1], accountAction[2], body, async (password, existing, username) => {
      validatePassword(password, username);
      if (await verifyPassword(password, existing)) fail('Choose a temporary password different from the current password.');
      return hashPassword(password);
    }));
  }
  if (inventory) {
    if (inventory.action || inventory.resource === 'opening-balances') requireAdministrator(user);
    else requireOperationalAccess(user, inventoryPermissions.get(inventory.workflow ?? inventory.resource));
    return json(await writeInventory(env.DB, inventory, body, user), inventory.action === 'cancel' ? 200 : 201);
  }
  if (management) {
    if (management.detail === 'summary') return json({ message: 'Method not allowed.' }, 405, { Allow: 'GET' });
    if (management.resource === 'purchase-orders') requireOperationalAccess(user, STORES_DEMANDS);
    else requireAdministrator(user);
    return json(await writeManagement(env.DB, management, body, user), management.detail ? 200 : 201);
  }
  if (path === '/api/staff' || path === '/api/users') {
    requireAdministrator(user);
    const accountMode = body.accountMode ?? 'create';
    if (accountMode !== 'create' && !(path === '/api/staff' && accountMode === 'existing'))
      fail('Choose whether to create or link a login.');
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (!/^[a-zA-Z0-9_.-]{2,40}$/.test(username)) fail('Username must contain 2–40 letters, numbers, dots, underscores or hyphens.');

    if (accountMode === 'existing') {
      const [result] = await env.DB.batch([env.DB.prepare(`UPDATE staff SET permissions = ?
        WHERE username = ? AND permissions = 0 AND ${VERIFIED_CREDENTIALS} AND ${LIVE_ADMIN} RETURNING id`)
        .bind(ALL_PERMISSIONS, username, user.token_hash),
        env.DB.prepare(`INSERT INTO security_events (actor_id, target_id, action)
          SELECT ?, id, 'account.grant-stores' FROM staff WHERE username = ? AND changes() > 0`).bind(user.id, username)]);
      if (result.results.length) return json({ message: 'Stores permissions granted.' }, 201);
      if (!await env.DB.prepare('SELECT id FROM staff WHERE username = ?').bind(username).first())
        fail('No user account matches that username.', 404);
      fail('This login already has permissions or needs an administrator-issued password.', 409);
    }

    if (username.toLowerCase() === 'admin') fail('That username is reserved.', 409);
    if (!['user', 'admin'].includes(body.role)) fail('Choose a valid account role.');
    validatePassword(body.password, username);
    const permissions = body.permissions === undefined
      ? (path === '/api/staff' ? ALL_PERMISSIONS : 0)
      : permissionMask(body.permissions);
    try {
      const hash = await hashPassword(body.password);
      const [result] = await env.DB.batch([
        env.DB.prepare(INSERT_ADMIN_CREATED_USER).bind(username, hash, body.role, permissions, user.token_hash),
        env.DB.prepare(`INSERT INTO security_events (actor_id, target_id, action)
          SELECT ?, id, 'account.create' FROM staff WHERE username = ? AND password_hash = ? AND changes() > 0`)
          .bind(user.id, username, hash),
        env.DB.prepare(`INSERT INTO staff_verified_credentials (user_id)
          SELECT id FROM staff WHERE username = ? AND password_hash = ?`).bind(username, hash)
      ]);
      if (!result.meta.changes) fail('Your session changed. Please sign in again.', 401);
    } catch (error) {
      const details = [error.message, error.cause?.message].filter(Boolean).join(' ');
      if (/UNIQUE constraint failed:\s*staff\.username/i.test(details)) fail('That username is already registered.', 409);
      throw error;
    }
    return json({ message: 'Account created. The user must change their temporary password on first login.' }, 201);
  }
  return json({ message: 'Not found.' }, 404);
}

export default {
  async scheduled(_controller, env) {
    const hook = env.CLOUDFLARE_DEPLOY_HOOK_URL?.trim() ?? '';
    if (!/^https:\/\/api\.cloudflare\.com\/client\/v4\/workers\/builds\/deploy_hooks\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(hook))
      throw new Error('Set the scheduled Cloudflare deploy hook secret.');

    let response;
    try {
      response = await fetch(hook, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000) });
    } catch {
      throw new Error('The scheduled Cloudflare hook could not be reached.');
    }
    if (!response.ok) throw new Error(`The scheduled Cloudflare hook returned HTTP ${response.status}.`);
    const { success, result } = await response.json();
    if (!success || !result?.build_uuid) throw new Error('Cloudflare did not acknowledge the scheduled build.');
    console.log('Scheduled Cloudflare build', { id: result.build_uuid, status: result.status, reused: result.already_exists });
  },
  async fetch(request, env, ctx) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return await api(request, env, ctx); }
    catch (error) {
      // Expected validation errors are safe to display. Internal SQL/runtime
      // details stay in Worker logs rather than leaking through API responses.
      if (!error.status) console.error('API error', error);
      return json({ message: error.status ? error.message : 'The service is temporarily unavailable. Please try again.' }, error.status || 503);
    }
  }
};
