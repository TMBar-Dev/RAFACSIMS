import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const BOOTSTRAP = 'ReviewBootstrap!123';

// Isolated API checks: real SQLite statements and Web Crypto, with a small D1
// result-shape adapter. No network, production database or account is touched.
// This does not emulate Workerd, Cloudflare limits or browser cookie handling.
class TestD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:');
    this.database.exec('PRAGMA foreign_keys = ON');
  }
  prepare(sql) {
    const database = this.database;
    const fixture = this;
    function statement(values = []) {
      function execute() {
        fixture.beforeExecute?.(sql);
        const prepared = database.prepare(sql);
        let results = [];
        if (prepared.columns().length) results = prepared.all(...values).map(row => ({ ...row }));
        else prepared.run(...values);
        const meta = database.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id').get();
        return { success: true, results, meta: { ...meta } };
      }
      return {
        bind: (...nextValues) => statement(nextValues),
        execute,
        run: async () => execute(),
        all: async () => execute(),
        first: async () => {
          fixture.beforeExecute?.(sql);
          const row = database.prepare(sql).get(...values);
          return row ? { ...row } : null;
        }
      };
    }
    return statement();
  }
  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const result = statements.map(statement => statement.execute());
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

test('User Management, settings and account regressions', async t => {
  const DB = new TestD1();
  t.after(() => DB.database.close());
  // A fresh module instance gives this isolated database its own init promise.
  const { default: worker } = await import(`./worker.js?api-test=${Date.now()}`);
  const origin = 'https://rafacsims.example';
  let requestNumber = 0;
  function fetchApi(path, { body, cookie, requestOrigin = origin } = {}) {
    const headers = { 'CF-Connecting-IP': `192.0.2.${++requestNumber}` };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) Object.assign(headers, { Origin: requestOrigin, 'Content-Type': 'application/json' });
    return worker.fetch(new Request(`${origin}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), { DB, ADMIN_BOOTSTRAP_PASSWORD: BOOTSTRAP });
  }
  async function request(path, options) {
    const response = await fetchApi(path, options);
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('Set-Cookie')?.split(';')[0]
    };
  }
  const account = { username: 'new.user', password: 'TemporaryUser!123', role: 'user' };
  let adminCookie;

  await t.test('requires authentication and a changed admin password', async () => {
    assert.equal((await request('users')).status, 401);
    assert.equal((await request('users', { body: account })).status, 401);
    const initial = await request('login', { body: { username: 'admin', password: BOOTSTRAP } });
    assert.equal(initial.status, 200);
    assert.equal(initial.data.user.mustChangePassword, true);
    assert.equal((await request('users', { cookie: initial.cookie })).status, 403);
    assert.equal((await request('users', { cookie: initial.cookie, body: account })).status, 403);
    const changed = await request('change-password', { cookie: initial.cookie,
      body: { currentPassword: BOOTSTRAP, newPassword: 'ChangedAdmin!123' } });
    assert.equal(changed.status, 200);
    adminCookie = changed.cookie;
    assert.notEqual(adminCookie, initial.cookie);
    assert.equal((await request('users', { cookie: initial.cookie })).status, 401);
    assert.equal((await request('session', { cookie: adminCookie })).data.user.mustChangePassword, false);
    assert.equal((await request('users', { cookie: adminCookie })).status, 200);
  });

  await t.test('ordinary registration cannot grant administrator permissions', async () => {
    const registered = await request('register', { body: { username: 'ordinary', password: 'OrdinaryPass!123', role: 'admin' } });
    assert.equal(registered.status, 201);
    const login = await request('login', { body: { username: 'ordinary', password: 'OrdinaryPass!123' } });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.role, 'user');
    assert.equal((await request('users', { cookie: login.cookie })).status, 403);
    assert.equal((await request('users', { cookie: login.cookie, body: account })).status, 403);
    assert.equal((await request('users', { cookie: adminCookie, body: account, requestOrigin: 'https://other.example' })).status, 403);
    assert.equal(DB.database.prepare('SELECT count(*) AS total FROM users').get().total, 2);
  });

  await t.test('bounds ordinary JSON requests by actual bytes even without Content-Length', async () => {
    const result = await request('register', { body: { username: 'oversized.test', password: 'é'.repeat(2300) } });
    assert.equal(result.status, 413);
    assert.equal(DB.database.prepare('SELECT id FROM users WHERE username = ?').get('oversized.test'), undefined);
  });

  await t.test('creates validated accounts with first-login enforcement and preserves account flows', async () => {
    assert.equal((await request('users', { cookie: adminCookie, body: account })).status, 201);
    const record = DB.database.prepare('SELECT * FROM users WHERE username = ?').get(account.username);
    assert.equal(record.must_change_password, 1);
    assert.match(record.password_hash, /^pbkdf2\$100000\$/);
    assert.notEqual(record.password_hash, account.password);
    assert.equal((await request('users', { cookie: adminCookie, body: { ...account, username: 'NEW.USER' } })).status, 409);
    assert.equal((await request('users', { cookie: adminCookie, body: { ...account, username: 'admin' } })).status, 409);
    assert.equal((await request('users', { cookie: adminCookie, body: { ...account, username: 'invalid-role', role: 'owner' } })).status, 400);
    assert.equal((await request('users', { cookie: adminCookie, body: { ...account, username: 'short-password', password: 'short' } })).status, 400);
    assert.equal((await request('users', { cookie: adminCookie, body: { ...account, username: 'second.admin', role: 'admin' } })).status, 201);
    const otherAdmin = await request('login', { body: { username: 'second.admin', password: account.password } });
    assert.equal(otherAdmin.data.user.role, 'admin');
    assert.equal((await request('users', { cookie: otherAdmin.cookie })).status, 403);
    assert.equal((await request('users', { cookie: otherAdmin.cookie, body: { ...account, username: 'not.allowed' } })).status, 403);
    const login = await request('login', { body: account });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.mustChangePassword, true);
    const changed = await request('change-password', { cookie: login.cookie,
      body: { currentPassword: account.password, newPassword: 'ReplacementUser!456' } });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.user.mustChangePassword, false);
    assert.equal((await request('session', { cookie: login.cookie })).data.user, null);
    assert.equal((await request('login', { body: account })).status, 401);
    assert.equal((await request('login', { body: { username: account.username, password: 'ReplacementUser!456' } })).status, 200);
    assert.equal((await request('logout', { cookie: changed.cookie, body: {} })).status, 200);
    assert.equal((await request('session', { cookie: changed.cookie })).data.user, null);
  });

  await t.test('lists only safe fields with stable pagination and rejects invalid cursors', async () => {
    // Seed list fixtures directly: this test exercises pagination, not hashing.
    const hash = DB.database.prepare('SELECT password_hash FROM users WHERE username = ?').get('admin').password_hash;
    const insert = DB.database.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    for (let i = 0; i < 27; i++) insert.run(`page.user.${i}`, hash);
    const first = await request('users', { cookie: adminCookie });
    assert.equal(first.status, 200);
    assert.equal(first.data.users.length, 25);
    assert.equal(first.data.nextCursor, first.data.users.at(-1).id);
    const second = await request(`users?after=${first.data.nextCursor}`, { cookie: adminCookie });
    assert.equal(second.status, 200);
    assert.equal(second.data.nextCursor, null);
    const all = [...first.data.users, ...second.data.users];
    assert.equal(new Set(all.map(user => user.id)).size, all.length);
    assert.equal(all.length, DB.database.prepare('SELECT count(*) AS total FROM users').get().total);
    for (const user of all) {
      assert.deepEqual(Object.keys(user).sort(), ['active', 'createdAt', 'id', 'mustChangePassword', 'role', 'username']);
      assert.equal(typeof user.mustChangePassword, 'boolean');
      assert.equal(typeof user.createdAt, 'number');
    }
    for (const after of ['-1', 'invalid', '9007199254740992']) {
      assert.equal((await request(`users?after=${after}`, { cookie: adminCookie })).status, 400);
    }
  });

  await t.test('edits, resets and deactivates linked users while preserving staff and history references', async () => {
    const admin = { cookie: adminCookie };
    const name = account.username;
    const oldPassword = 'ReplacementUser!456';
    const login = await request('login', { body: { username: name, password: oldPassword } });
    const target = DB.database.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(name);
    const userPath = `users/${target.id}`;
    const edit = { previousUsername: name, previousRole: 'user', username: 'renamed.staff', role: 'user' };
    assert.equal((await request(`${userPath}/edit`, { body: edit })).status, 401);
    assert.equal((await request(`${userPath}/edit`, { cookie: login.cookie, body: edit })).status, 403);
    assert.equal((await request(`${userPath}/edit`, { ...admin, body: { ...edit, username: 'ordinary' } })).status, 409);
    assert.equal((await request(`${userPath}/edit`, { ...admin, body: { ...edit, username: 'ADMIN' } })).status, 409);
    assert.equal((await request('staff', { ...admin, body: { accountMode: 'existing', username: name } })).status, 201);
    const link = DB.database.prepare('SELECT id FROM staff WHERE user_id = ?').get(target.id);
    DB.database.prepare(`INSERT INTO inventory_transactions
      (kind, party_name, actor_id, actor_name, request_key, request_fingerprint, write_token)
      VALUES ('issue', 'Fixture recipient', ?, ?, 'history-test-key', 'fixture', 'history-test-write')`).run(target.id, name);
    assert.equal((await request(`${userPath}/edit`, { ...admin, body: edit })).status, 200);
    assert.equal((await request(`${userPath}/edit`, { ...admin, body: edit })).status, 409);
    assert.equal((await request('session', { cookie: login.cookie })).data.user, null);
    assert.equal(DB.database.prepare('SELECT password_hash FROM users WHERE id = ?').get(target.id).password_hash, target.password_hash);
    assert.equal((await request('login', { body: { username: name, password: oldPassword } })).status, 401);
    const renamed = await request('login', { body: { username: edit.username, password: oldPassword } });
    assert.equal(renamed.status, 200);
    assert.equal((await request('operations/access', { cookie: renamed.cookie })).status, 200);

    const temporary = 'ResetTemporary!789';
    assert.equal((await request(`${userPath}/reset-password`, { ...admin, body: { password: oldPassword } })).status, 400);
    assert.equal((await request(`${userPath}/reset-password`, { ...admin, body: { password: temporary } })).status, 200);
    assert.equal((await request('session', { cookie: renamed.cookie })).data.user, null);
    assert.equal((await request('login', { body: { username: edit.username, password: oldPassword } })).status, 401);
    const reset = await request('login', { body: { username: edit.username, password: temporary } });
    assert.equal(reset.data.user.mustChangePassword, true);
    assert.equal((await request('operations/access', { cookie: reset.cookie })).status, 403);
    assert.equal((await request(`${userPath}/deactivate`, { ...admin, body: {} })).status, 200);
    assert.equal((await request('session', { cookie: reset.cookie })).data.user, null);
    assert.equal((await request('login', { body: { username: edit.username, password: temporary } })).status, 401);
    const listed = (await request('staff', admin)).data.staff.find(row => row.id === link.id);
    assert.equal(listed.account.active, false);
    assert.equal(listed.account.id, target.id);
    assert.equal((await request(`${userPath}/reactivate`, { ...admin, body: {} })).status, 200);
    assert.equal((await request('session', { cookie: reset.cookie })).data.user, null);
    const enabled = await request('login', { body: { username: edit.username, password: temporary } });
    assert.equal(enabled.data.user.mustChangePassword, true);
    const changed = await request('change-password', { cookie: enabled.cookie, body: {
      currentPassword: temporary, newPassword: 'AfterAdminReset!456'
    } });
    assert.equal(changed.status, 200);
    assert.equal((await request('operations/access', { cookie: changed.cookie })).status, 200);
    assert.equal((await request(`${userPath}/edit`, { ...admin, body: {
      username: edit.username, previousUsername: edit.username, role: 'admin', previousRole: 'user'
    } })).status, 200);
    assert.equal((await request('session', { cookie: changed.cookie })).data.user, null);
    const promoted = await request('login', { body: { username: edit.username, password: 'AfterAdminReset!456' } });
    assert.equal((await request('users', { cookie: promoted.cookie })).status, 200);
    assert.equal((await request(`${userPath}/edit`, { ...admin, body: {
      username: edit.username, previousUsername: edit.username, role: 'user', previousRole: 'admin'
    } })).status, 200);
    assert.equal((await request('session', { cookie: promoted.cookie })).data.user, null);
    const history = DB.database.prepare('SELECT actor_id, actor_name FROM inventory_transactions WHERE request_key = ?')
      .get('history-test-key');
    assert.equal(history.actor_id, target.id);
    assert.equal(history.actor_name, name);
  });

  await t.test('stores administrator-only settings and serves verified branding without replacing a saved image on failure', async () => {
    const admin = { cookie: adminCookie };
    const ordinary = await request('login', { body: { username: 'ordinary', password: 'OrdinaryPass!123' } });
    const values = { name: 'Fixture Squadron Stores', shortName: 'Fixture Stores', aboutUs: 'Test information\nFor signed-in users' };
    assert.deepEqual((await request('branding')).data, {
      name: 'RAFACSIMS', shortName: 'RAFACSIMS', logoUrl: null, coverUrl: null
    });
    assert.equal((await request('settings')).status, 401);
    assert.equal((await request('about')).status, 401);
    assert.equal((await request('settings', { cookie: ordinary.cookie })).status, 403);
    assert.equal((await request('settings', { cookie: ordinary.cookie, body: values })).status, 403);
    assert.equal((await request('settings', { ...admin, body: values, requestOrigin: 'https://other.example' })).status, 403);
    assert.equal((await request('settings', { ...admin, body: { ...values, shortName: '' } })).status, 400);
    assert.equal((await request('settings', { ...admin, body: values })).data.name, values.name);
    assert.equal((await request('settings', admin)).data.aboutUs, values.aboutUs);
    assert.equal((await request('about', { cookie: ordinary.cookie })).data.aboutUs, values.aboutUs);
    assert.equal(Object.hasOwn((await request('branding')).data, 'aboutUs'), false);

    // Tiny, generated image bytes exercise the real endpoint without assets
    // from V1 or any device/browser-specific image dependencies.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAQSURBVBhXY/i/lOE/AzIAAClDAqSBuAheAAAAAElFTkSuQmCC';
    const jpeg = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm2wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8sb+/udVvrm9vbiW8vLmRpp7i4cvJLIxJZ2Y8sxJJJPJJooornw38CHovyNav8SXqz//Z';
    assert.equal((await request('branding/logo', { cookie: ordinary.cookie, body: { content: png } })).status, 403);
    const logo = await request('branding/logo', { ...admin, body: { content: png } });
    assert.equal(logo.status, 200);
    assert.match(logo.data.logoUrl, /^\/api\/branding\/logo\?v=/);
    assert.equal((await request('branding/cover', { ...admin, body: { content: jpeg } })).status, 200);
    const image = await fetchApi('branding/logo');
    assert.equal(image.headers.get('Content-Type'), 'image/png');
    assert.equal(image.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'), png);
    const cover = await fetchApi('branding/cover');
    assert.equal(cover.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(Buffer.from(await cover.arrayBuffer()).toString('base64'), jpeg);
    assert.equal((await request('branding/logo', { ...admin, body: { content: Buffer.from('<svg/>').toString('base64') } })).status, 400);
    assert.equal((await request('branding/logo', { ...admin, body: { content: png.slice(0, -8) } })).status, 400);
    assert.equal((await request('branding/logo', { ...admin, body: { content: 'A'.repeat(200000) } })).status, 413);
    DB.database.exec(`CREATE TEMP TRIGGER reject_branding_fixture BEFORE UPDATE ON branding_images
      BEGIN SELECT RAISE(ABORT, 'Simulated image write failure'); END`);
    const originalError = console.error;
    let failed;
    try {
      console.error = () => {};
      failed = await request('branding/logo', { ...admin, body: { content: jpeg } });
    } finally {
      console.error = originalError;
      DB.database.exec('DROP TRIGGER reject_branding_fixture');
    }
    assert.equal(failed.status, 503);
    assert.equal((await request('branding')).data.logoUrl, logo.data.logoUrl);
    assert.equal(Buffer.from(await (await fetchApi('branding/logo')).arrayBuffer()).toString('base64'), png);
    const replaced = await request('branding/logo', { ...admin, body: { content: jpeg } });
    assert.equal(replaced.status, 200);
    assert.equal(replaced.data.logoFallbackUrl, logo.data.logoUrl);
    const prior = await fetchApi(logo.data.logoUrl.slice('/api/'.length));
    assert.equal(Buffer.from(await prior.arrayBuffer()).toString('base64'), png);
    const revision = new URL(logo.data.logoUrl, origin).searchParams.get('v');
    assert.equal((await request('branding/logo', { ...admin, body: { restore: true, revision } })).data.logoUrl, logo.data.logoUrl);
    assert.equal(Buffer.from(await (await fetchApi('branding/logo')).arrayBuffer()).toString('base64'), png);
  });

  await t.test('refuses account creation if the administrator session ends before its write', async () => {
    const secondary = await request('login', { body: { username: 'admin', password: 'ChangedAdmin!123' } });
    const token = secondary.cookie.split('=')[1];
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
    DB.beforeExecute = sql => {
      if (/INSERT INTO users/i.test(sql) && /must_change_password/i.test(sql)) {
        DB.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      }
    };
    try {
      const result = await request('users', { cookie: secondary.cookie, body: {
        username: 'revoked.create', password: 'RevokedNewPassword!123', role: 'admin'
      } });
      assert.equal(result.status, 401);
      assert.equal(DB.database.prepare('SELECT id FROM users WHERE username = ?').get('revoked.create'), undefined);
    } finally {
      DB.beforeExecute = undefined;
    }
  });

  await t.test('requires another ready administrator and serializes competing deactivations', async () => {
    const bootstrapId = DB.database.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
    const secondId = DB.database.prepare("SELECT id FROM users WHERE username = 'second.admin'").get().id;
    assert.equal((await request(`users/${bootstrapId}/deactivate`, { cookie: adminCookie, body: {} })).status, 409);
    assert.equal((await request(`users/${bootstrapId}/reset-password`, { cookie: adminCookie, body: {
      password: 'NewAdminTemporary!123'
    } })).status, 409);
    const second = await request('login', { body: { username: 'second.admin', password: account.password } });
    assert.equal((await request('settings', { cookie: second.cookie })).status, 403);
    const changed = await request('change-password', { cookie: second.cookie, body: {
      currentPassword: account.password, newPassword: 'ReadySecondAdmin!123'
    } });
    assert.equal(changed.status, 200);
    assert.equal((await request(`users/${bootstrapId}/edit`, { cookie: changed.cookie, body: {
      username: 'admin-new', role: 'admin', previousUsername: 'admin', previousRole: 'admin'
    } })).status, 409);
    const results = await Promise.all([
      request(`users/${secondId}/deactivate`, { cookie: adminCookie, body: {} }),
      request(`users/${bootstrapId}/deactivate`, { cookie: changed.cookie, body: {} })
    ]);
    assert.equal(results.filter(result => result.status === 200).length, 1);
    assert.ok(results.every(result => [200, 401, 409].includes(result.status)));
    assert.equal(DB.database.prepare(`SELECT count(*) AS total FROM users u
      WHERE role = 'admin' AND must_change_password = 0
      AND NOT EXISTS (SELECT 1 FROM account_deactivations WHERE user_id = u.id)`).get().total, 1);
  });
});

test('a fresh database requires deployment-controlled administrator provisioning', async t => {
  const DB = new TestD1();
  t.after(() => DB.database.close());
  const { default: worker } = await import('./worker.js?review-no-bootstrap');
  const response = await worker.fetch(new Request('https://rafacsims.example/api/session'), { DB });
  assert.deepEqual(await response.json(), { user: null });
  assert.equal(DB.database.prepare("SELECT id FROM users WHERE username = 'admin'").get(), undefined);
  const { default: provisioned } = await import('./worker.js?review-with-bootstrap');
  const enabled = await provisioned.fetch(new Request('https://rafacsims.example/api/session'), {
    DB, ADMIN_BOOTSTRAP_PASSWORD: BOOTSTRAP
  });
  assert.equal(enabled.status, 200);
  assert.equal(DB.database.prepare("SELECT must_change_password FROM users WHERE username = 'admin'").get().must_change_password, 1);
});
