import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

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
    function statement(values = []) {
      function execute() {
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

test('User Management permissions, creation and account regressions', async t => {
  const DB = new TestD1();
  t.after(() => DB.database.close());
  // A fresh module instance gives this isolated database its own init promise.
  const { default: worker } = await import(`./worker.js?api-test=${Date.now()}`);
  const origin = 'https://rafacsims.example';
  let requestNumber = 0;
  async function request(path, { body, cookie, requestOrigin = origin } = {}) {
    const headers = { 'CF-Connecting-IP': `192.0.2.${++requestNumber}` };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) Object.assign(headers, { Origin: requestOrigin, 'Content-Type': 'application/json' });
    const response = await worker.fetch(new Request(`${origin}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), { DB });
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
    const initial = await request('login', { body: { username: 'admin', password: 'RAFACSIMS' } });
    assert.equal(initial.status, 200);
    assert.equal(initial.data.user.mustChangePassword, true);
    assert.equal((await request('users', { cookie: initial.cookie })).status, 403);
    assert.equal((await request('users', { cookie: initial.cookie, body: account })).status, 403);
    const changed = await request('change-password', { cookie: initial.cookie,
      body: { currentPassword: 'RAFACSIMS', newPassword: 'ChangedAdmin!123' } });
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
      assert.deepEqual(Object.keys(user).sort(), ['createdAt', 'id', 'mustChangePassword', 'role', 'username']);
      assert.equal(typeof user.mustChangePassword, 'boolean');
      assert.equal(typeof user.createdAt, 'number');
    }
    for (const after of ['-1', 'invalid', '9007199254740992']) {
      assert.equal((await request(`users?after=${after}`, { cookie: adminCookie })).status, 400);
    }
  });
});
