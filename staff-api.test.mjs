import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

// Real SQLite and Web Crypto with only D1's result/transaction shape adapted.
// Everything stays in memory: these tests do not contact D1, build the frontend,
// emulate browser cookie rules or establish Cloudflare runtime compatibility.
class TestD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:');
    this.database.exec('PRAGMA foreign_keys = ON');
    this.failStaffInsert = false;
  }
  prepare(sql) {
    const fixture = this;
    const database = this.database;
    function statement(values = []) {
      function execute() {
        // Exercise rollback after the account INSERT, not only validation that
        // rejects a duplicate before the transaction starts.
        if (fixture.failStaffInsert && /INSERT\s+INTO\s+staff\b/i.test(sql)) {
          fixture.failStaffInsert = false;
          throw new Error('Simulated staff insert failure');
        }
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

test('Staff Accounts creates linked logins without changing existing accounts', async t => {
  const DB = new TestD1();
  t.after(() => DB.database.close());
  let importNumber = 0;
  let worker;
  async function reloadWorker() {
    // Each Worker isolate gets a fresh init promise, while D1 data survives.
    ({ default: worker } = await import(`./worker.js?staff-api-test=${Date.now()}-${++importNumber}`));
  }
  await reloadWorker();
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
    return { status: response.status, data: await response.json(), cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
  }
  const credentials = {
    username: 'staff.login', password: 'TemporaryStaff!123', role: 'user'
  };
  let adminCookie;

  await t.test('requires a changed administrator password and includes the existing admin link', async () => {
    assert.equal((await request('staff')).status, 401);
    assert.equal((await request('staff', { body: credentials })).status, 401);
    const initial = await request('login', { body: { username: 'admin', password: 'RAFACSIMS' } });
    assert.equal(initial.status, 200);
    assert.equal((await request('staff', { cookie: initial.cookie })).status, 403);
    assert.equal((await request('staff', { cookie: initial.cookie, body: credentials })).status, 403);
    const changed = await request('change-password', { cookie: initial.cookie,
      body: { currentPassword: 'RAFACSIMS', newPassword: 'ChangedAdmin!123' } });
    assert.equal(changed.status, 200);
    adminCookie = changed.cookie;
    const list = await request('staff', { cookie: adminCookie });
    assert.equal(list.status, 200);
    const admin = list.data.staff.find(row => row.account?.username === 'admin');
    assert.ok(admin);
    assert.equal(admin.account.role, 'admin');
    assert.equal(admin.account.mustChangePassword, false);

    const password = DB.database.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get().password_hash;
    DB.database.prepare('UPDATE staff SET first_name = ?, appointment = ? WHERE id = ?')
      .run('Existing', 'Keep this appointment', admin.id);
    await reloadWorker();
    const after = await request('staff', { cookie: adminCookie });
    assert.equal(after.status, 200);
    const preserved = after.data.staff.find(row => row.account?.username === 'admin');
    assert.equal(preserved.id, admin.id);
    const stored = DB.database.prepare('SELECT first_name, appointment FROM staff WHERE id = ?').get(admin.id);
    assert.equal(stored.first_name, 'Existing');
    assert.equal(stored.appointment, 'Keep this appointment');
    assert.equal(DB.database.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get().password_hash, password);
    assert.equal((await request('login', { body: { username: 'admin', password: 'ChangedAdmin!123' } })).status, 200);
    assert.equal((await request('login', { body: { username: 'admin', password: 'RAFACSIMS' } })).status, 401);
  });

  await t.test('ordinary users and cross-origin requests cannot create staff logins', async () => {
    assert.equal((await request('register', { body: { username: 'ordinary', password: 'OrdinaryPass!123' } })).status, 201);
    const ordinary = await request('login', { body: { username: 'ordinary', password: 'OrdinaryPass!123' } });
    assert.equal((await request('staff', { cookie: ordinary.cookie })).status, 403);
    assert.equal((await request('staff', { cookie: ordinary.cookie, body: credentials })).status, 403);
    assert.equal((await request('staff', { cookie: adminCookie, body: credentials, requestOrigin: 'https://other.example' })).status, 403);
    assert.equal(DB.database.prepare('SELECT count(*) AS total FROM staff').get().total, 1);
  });

  await t.test('creates a staff profile and usable login with mandatory first-login password change', async () => {
    const created = await request('staff', { cookie: adminCookie, body: credentials });
    assert.equal(created.status, 201);
    const user = DB.database.prepare('SELECT * FROM users WHERE username = ?').get(credentials.username);
    const staff = DB.database.prepare('SELECT * FROM staff WHERE user_id = ?').get(user.id);
    assert.equal(staff.first_name, '-');
    assert.equal(staff.last_name, '-');
    assert.equal(staff.service_number, null);
    assert.equal(user.must_change_password, 1);
    assert.match(user.password_hash, /^pbkdf2\$100000\$/);
    assert.notEqual(user.password_hash, credentials.password);
    assert.equal((await request('session', { cookie: adminCookie })).data.user.username, 'admin');
    const login = await request('login', { body: { username: credentials.username, password: credentials.password } });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.mustChangePassword, true);
    const changed = await request('change-password', { cookie: login.cookie,
      body: { currentPassword: credentials.password, newPassword: 'ReplacementStaff!456' } });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.user.mustChangePassword, false);
    assert.equal((await request('session', { cookie: login.cookie })).data.user, null);
    assert.equal((await request('login', { body: { username: credentials.username, password: credentials.password } })).status, 401);
    assert.equal((await request('login', { body: { username: credentials.username, password: 'ReplacementStaff!456' } })).status, 200);

    assert.equal((await request('staff', { cookie: adminCookie,
      body: { ...credentials, username: 'staff.admin', role: 'admin' } })).status, 201);
    const newAdmin = await request('login', { body: { username: 'staff.admin', password: credentials.password } });
    assert.equal(newAdmin.data.user.role, 'admin');
    assert.equal((await request('staff', { cookie: newAdmin.cookie })).status, 403);
    assert.equal((await request('staff', { cookie: newAdmin.cookie, body: { ...credentials, username: 'not.allowed' } })).status, 403);
  });

  await t.test('links an existing login without changing its credentials or permissions', async () => {
    assert.equal((await request('users', { cookie: adminCookie,
      body: { username: 'existing.login', password: 'ExistingLogin!123', role: 'user' } })).status, 201);
    const before = DB.database.prepare("SELECT * FROM users WHERE username = 'existing.login'").get();
    const body = { accountMode: 'existing', username: 'EXISTING.LOGIN' };
    assert.equal((await request('staff', { cookie: adminCookie, body })).status, 201);
    const after = DB.database.prepare('SELECT * FROM users WHERE id = ?').get(before.id);
    assert.deepEqual({ ...after }, { ...before });
    assert.equal(DB.database.prepare('SELECT user_id FROM staff WHERE user_id = ?').get(before.id).user_id, before.id);
    assert.equal((await request('login', { body: { username: 'existing.login', password: 'ExistingLogin!123' } })).status, 200);
    assert.equal((await request('staff', { cookie: adminCookie, body })).status, 409);
    assert.equal((await request('staff', { cookie: adminCookie, body: { ...body, username: 'missing.account' } })).status, 404);
  });

  await t.test('rejects invalid records and rolls back both inserts if staff creation fails', async () => {
    const usersBefore = DB.database.prepare('SELECT count(*) AS total FROM users').get().total;
    const staffBefore = DB.database.prepare('SELECT count(*) AS total FROM staff').get().total;
    assert.equal((await request('staff', { cookie: adminCookie,
      body: { ...credentials, username: 'STAFF.LOGIN' } })).status, 409);
    for (const override of [{ username: '!' }, { role: 'owner' }, { password: 'short' }, { accountMode: 'invalid' }]) {
      assert.equal((await request('staff', { cookie: adminCookie,
        body: { ...credentials, username: 'invalid.staff', ...override } })).status, 400);
    }
    assert.equal((await request('staff', { cookie: adminCookie, body: { ...credentials, username: 'admin' } })).status, 409);

    DB.failStaffInsert = true;
    const originalError = console.error;
    let failed;
    try {
      // The deliberate adapter failure is expected to be logged internally by
      // the Worker; avoid printing a synthetic production-looking error here.
      console.error = () => {};
      failed = await request('staff', { cookie: adminCookie,
        body: { ...credentials, username: 'rollback.staff' } });
    } finally { console.error = originalError; }
    assert.equal(failed.status, 503);
    assert.equal(DB.database.prepare("SELECT id FROM users WHERE username = 'rollback.staff'").get(), undefined);
    assert.equal(DB.database.prepare('SELECT count(*) AS total FROM users').get().total, usersBefore);
    assert.equal(DB.database.prepare('SELECT count(*) AS total FROM staff').get().total, staffBefore);
  });

  await t.test('paginates public staff fields and includes unlinked profiles safely', async () => {
    const insert = DB.database.prepare('INSERT INTO staff (first_name, last_name) VALUES (?, ?)');
    for (let i = 0; i < 27; i++) insert.run('Fixture', `Person ${i}`);
    const first = await request('staff', { cookie: adminCookie });
    assert.equal(first.status, 200);
    assert.equal(first.data.staff.length, 25);
    assert.equal(first.data.nextCursor, first.data.staff.at(-1).id);
    const second = await request(`staff?after=${first.data.nextCursor}`, { cookie: adminCookie });
    assert.equal(second.status, 200);
    assert.equal(second.data.nextCursor, null);
    const rows = [...first.data.staff, ...second.data.staff];
    assert.equal(rows.length, DB.database.prepare('SELECT count(*) AS total FROM staff').get().total);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    assert.ok(rows.some(row => row.account === null));
    const keys = ['account', 'id'];
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), keys);
      if (row.account) assert.deepEqual(Object.keys(row.account).sort(), ['id', 'username', 'role', 'mustChangePassword'].sort());
    }
    for (const after of ['-1', 'invalid', '9007199254740992']) {
      assert.equal((await request(`staff?after=${after}`, { cookie: adminCookie })).status, 400);
    }
  });
});
