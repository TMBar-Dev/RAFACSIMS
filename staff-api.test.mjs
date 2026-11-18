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

test('Staff Accounts and operational workflows', async t => {
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
    assert.equal((await request('operations/access')).status, 401);
    assert.equal((await request('staff', { body: credentials })).status, 401);
    const initial = await request('login', { body: { username: 'admin', password: 'RAFACSIMS' } });
    assert.equal(initial.status, 200);
    assert.equal((await request('staff', { cookie: initial.cookie })).status, 403);
    assert.deepEqual(await request('operations/access', { cookie: initial.cookie }), {
      status: 403, data: { message: 'Change your password before continuing.' }, cookie: undefined
    });
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
    assert.equal((await request('operations/access', { cookie: login.cookie })).status, 401);
    assert.equal((await request('operations/access', { cookie: changed.cookie })).status, 200);
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

  await t.test('operational access follows live roles and staff links without replacing sessions', async () => {
    const access = cookie => request('operations/access', { cookie });
    const adminId = DB.database.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
    const adminLink = DB.database.prepare('SELECT id FROM staff WHERE user_id = ?').get(adminId);
    const setLink = DB.database.prepare('UPDATE staff SET user_id = ? WHERE id = ?');
    setLink.run(null, adminLink.id);
    assert.equal((await access(adminCookie)).status, 200);
    setLink.run(adminId, adminLink.id);

    const ordinary = await request('login', { body: { username: 'ordinary', password: 'OrdinaryPass!123' } });
    const before = DB.database.prepare("SELECT * FROM users WHERE username = 'ordinary'").get();
    assert.equal((await access(ordinary.cookie)).status, 403);
    const linked = await request('staff', {
      cookie: adminCookie, body: { accountMode: 'existing', username: before.username }
    });
    assert.equal(linked.status, 201);
    assert.deepEqual(await access(ordinary.cookie), {
      status: 200, data: { canOperate: true }, cookie: undefined
    });
    assert.equal((await request('users', { cookie: ordinary.cookie })).status, 403);
    assert.equal((await request('staff', { cookie: ordinary.cookie })).status, 403);
    assert.deepEqual(DB.database.prepare('SELECT * FROM users WHERE id = ?').get(before.id), before);

    const link = DB.database.prepare('SELECT id FROM staff WHERE user_id = ?').get(before.id);
    setLink.run(null, link.id);
    assert.equal((await access(ordinary.cookie)).status, 403);
    assert.equal((await request('session', { cookie: ordinary.cookie })).data.user.username, before.username);
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

  await t.test('maintains searchable registers and restricts staff to active records and read access', async () => {
    const admin = { cookie: adminCookie };
    const staff = await request('login', { body: { username: credentials.username, password: 'ReplacementStaff!456' } });
    const staffSession = { cookie: staff.cookie };
    const ordinary = await request('login', { body: { username: 'ordinary', password: 'OrdinaryPass!123' } });
    const cadet = { first_name: 'Alex', last_name: 'Example', service_number: 'C-100', status: 'active', date_joined: '2024-02-29' };
    assert.equal((await request('cadets')).status, 401);
    assert.equal((await request('cadets', { cookie: ordinary.cookie })).status, 403);
    assert.equal((await request('cadets', { ...staffSession, body: cadet })).status, 403);
    assert.equal((await request('cadets', { ...admin, body: { ...cadet, date_joined: '2025-02-29' } })).status, 400);
    const created = await request('cadets', { ...admin, body: cadet });
    assert.equal(created.status, 201);
    const cadetPath = `cadets/${created.data.id}`;
    assert.equal((await request('cadets', { ...admin, body: { ...cadet, service_number: 'c-100' } })).status, 409);
    assert.equal((await request('cadets?q=alex%20ex', staffSession)).data.records[0].id, created.data.id);
    assert.equal((await request(cadetPath, staffSession)).data.record.date_joined, cadet.date_joined);
    assert.equal((await request(cadetPath, { ...admin, body: { ...cadet, status: 'left' } })).status, 200);
    assert.equal((await request(cadetPath, staffSession)).status, 404);
    assert.equal((await request(cadetPath, admin)).data.record.status, 'left');

    const supplier = { name: 'Uniform Supply', contact_person: 'Store contact', status: 'active' };
    assert.equal((await request('suppliers', { ...staffSession, body: supplier })).status, 403);
    const first = await request('suppliers', { ...admin, body: supplier });
    assert.equal(first.status, 201);
    assert.equal((await request('suppliers', { ...admin, body: { ...supplier, name: 'uniform supply' } })).status, 409);
    const item = { supplier_id: first.data.id, name: 'Trousers', description: 'Uniform trousers', uniform_type: 'blue', status: 'active' };
    const catalog = await request('catalog', { ...admin, body: item });
    assert.equal(catalog.status, 201);
    assert.equal((await request('catalog', { ...admin, body: { ...item, name: 'trousers' } })).status, 409);
    const variant = { item_id: catalog.data.id, size: 'Small', status: 'active' };
    const small = await request('variants', { ...admin, body: variant });
    assert.equal(small.status, 201);
    assert.equal((await request('variants', { ...admin, body: { ...variant, size: 'small' } })).status, 409);
    assert.equal((await request(`variants/${small.data.id}`, { ...admin, body: { status: 'inactive' } })).status, 200);
    assert.deepEqual((await request(`variants?itemId=${catalog.data.id}`, staffSession)).data.records, []);
    assert.equal((await request(`variants/${small.data.id}`, admin)).data.record.size, 'Small');

    const insertSupplier = DB.database.prepare("INSERT INTO suppliers (name, status) VALUES (?, 'active')");
    for (let index = 0; index < 26; index++) insertSupplier.run(`Paging supplier ${index}`);
    const page = (await request('suppliers?q=paging', staffSession)).data;
    const next = (await request(`suppliers?q=paging&after=${page.nextCursor}`, staffSession)).data;
    assert.equal(page.records.length, 25);
    assert.equal(next.records.length, 1);
    assert.ok(page.records.every(row => row.id < next.records[0].id));
    assert.equal(next.nextCursor, null);
  });

  await t.test('saves pending orders atomically, keeps line identities, and leaves stock unchanged', async () => {
    const admin = { cookie: adminCookie };
    const staff = await request('login', { body: { username: credentials.username, password: 'ReplacementStaff!456' } });
    const staffSession = { cookie: staff.cookie };
    const ordinary = await request('login', { body: { username: 'ordinary', password: 'OrdinaryPass!123' } });
    const { id: supplierId } = (await request('suppliers?q=uniform%20supply', admin)).data.records[0];
    const { id: itemId } = (await request(`catalog?supplierId=${supplierId}`, admin)).data.records[0];
    const { id: medium } = (await request('variants', { ...admin, body: { item_id: itemId, size: 'Medium', status: 'active' } })).data;
    const { id: large } = (await request('variants', { ...admin, body: { item_id: itemId, size: 'Large', status: 'active' } })).data;
    const { id: otherSupplier } = (await request('suppliers', { ...admin, body: { name: 'Other supplier', status: 'active' } })).data;
    const { id: otherItem } = (await request('catalog', { ...admin, body: {
      supplier_id: otherSupplier, name: 'Trousers', uniform_type: 'green', status: 'active'
    } })).data;
    const { id: foreign } = (await request('variants', { ...admin, body: { item_id: otherItem, size: 'Medium', status: 'active' } })).data;
    DB.database.exec("INSERT INTO stock (reference, description, quantity) VALUES ('V1-STOCK', 'Existing stock', 12)");
    const body = { supplierId, requestId: 'test-purchase-order-123', notes: 'Multi-size order', lines: [
      { variantId: medium, quantity: 6 }, { variantId: large, quantity: 4 }
    ] };
    assert.equal((await request('purchase-orders', { cookie: ordinary.cookie, body })).status, 403);
    assert.equal((await request('purchase-orders', { ...staffSession, body: {
      ...body, lines: [...body.lines, { variantId: foreign, quantity: 1 }]
    } })).status, 409);
    assert.equal(DB.database.prepare('SELECT count(*) AS total FROM purchase_orders').get().total, 0);
    assert.equal(DB.database.prepare('SELECT count(*) AS total FROM purchase_order_lines').get().total, 0);
    assert.equal((await request('purchase-orders', { ...staffSession, body: {
      ...body, lines: [{ variantId: medium, quantity: 1.5 }]
    } })).status, 400);

    const created = await request('purchase-orders', { ...staffSession, body });
    assert.equal(created.status, 201);
    assert.match(created.data.code, /^PO-\d{4,}$/);
    assert.deepEqual(await request('purchase-orders', { ...staffSession, body }), created);
    const path = `purchase-orders/${created.data.id}`;
    const first = (await request(path, staffSession)).data.record;
    assert.equal(first.status, 'pending');
    assert.equal(first.lines.length, 2);
    assert.deepEqual((await request('purchase-orders/summary', staffSession)).data, { pending: 1 });
    const row = (await request('purchase-orders?q=multi-size', staffSession)).data.records[0];
    assert.equal(row.line_count, 2);
    assert.equal(row.unit_count, 10);

    await request(`suppliers/${supplierId}`, { ...admin, body: { name: 'Renamed supplier', status: 'inactive' } });
    assert.deepEqual((await request(`variants?supplierId=${supplierId}`, staffSession)).data.records, []);
    assert.equal((await request(path, staffSession)).data.record.supplier_name, 'Uniform Supply');
    const change = { version: first.version, notes: 'Reduced order', lines: [{ variantId: medium, quantity: 5 }] };
    const competing = await Promise.all([
      request(path, { ...staffSession, body: change }),
      request(path, { ...staffSession, body: change })
    ]);
    assert.deepEqual(competing.map(result => result.status).sort(), [200, 409]);
    const edited = (await request(path, staffSession)).data.record;
    assert.equal(edited.version, first.version + 1);
    assert.equal(edited.lines.length, 1);
    assert.equal(edited.lines[0].id, first.lines[0].id);
    assert.equal(edited.lines[0].quantity, 5);
    assert.equal((await request(path, { ...staffSession, body: {
      ...change, version: edited.version, lines: [{ variantId: medium, quantity: 6 }]
    } })).status, 409);
    assert.deepEqual((await request(path, staffSession)).data.record, edited);
    assert.equal(DB.database.prepare("SELECT quantity FROM stock WHERE reference = 'V1-STOCK'").get().quantity, 12);
  });

  await t.test('receives purchases, posts stock and maintains one back order through repeat deliveries', async () => {
    const admin = { cookie: adminCookie };
    const login = await request('login', { body: { username: credentials.username, password: 'ReplacementStaff!456' } });
    const staff = { cookie: login.cookie };
    const supplier = (await request('suppliers', { ...admin, body: { name: 'Ledger supplier', status: 'active' } })).data.id;
    const item = (await request('catalog', { ...admin, body: {
      supplier_id: supplier, name: 'Ledger coat', uniform_type: 'blue', status: 'active'
    } })).data.id;
    const variant = size => request('variants', { ...admin, body: { item_id: item, size, status: 'active' } });
    const small = (await variant('Small')).data.id;
    const large = (await variant('Large')).data.id;
    const createOrder = lines => request('purchase-orders', { ...staff, body: { supplierId: supplier, lines } });
    const orderId = (await createOrder([{ variantId: small, quantity: 10 }, { variantId: large, quantity: 3 }])).data.id;
    const readOrder = async () => (await request(`purchase-orders/${orderId}`, staff)).data.record;
    const initial = await readOrder();
    const smallLine = initial.lines.find(line => line.variant_id === small).id;
    const largeLine = initial.lines.find(line => line.variant_id === large).id;
    const readStock = async () => (await request(`inventory-stock/${item}/sizes`, staff)).data.records.map(row => row.quantity);
    const receive = (lines, extras = {}) => request('receipts', { ...staff, body: { orderId, lines, ...extras } });
    assert.equal((await request('inventory-stock')).status, 401);
    assert.deepEqual(await readStock(), [0, 0]);
    assert.equal((await receive([{ orderLineId: smallLine, quantity: 0 }])).status, 400);
    assert.equal((await receive([{ orderLineId: smallLine, quantity: 1 }, { orderLineId: largeLine, quantity: 4 }])).status, 409);
    assert.deepEqual(await readStock(), [0, 0]);
    assert.deepEqual((await request(`receipts?orderId=${orderId}`, staff)).data.records, []);
    const step = [{ orderLineId: smallLine, quantity: 6 }, { orderLineId: largeLine, quantity: 0 }];
    const first = await receive(step, { requestId: 'test-receiving-first' });
    assert.equal(first.status, 201);
    assert.deepEqual(await receive(step, { requestId: 'test-receiving-first' }), first);
    assert.equal((await receive([{ orderLineId: smallLine, quantity: 7 }], { requestId: 'test-receiving-first' })).status, 409);
    const partial = await readOrder();
    assert.equal(partial.status, 'partial');
    assert.deepEqual(await readStock(), [6, 0]);
    assert.equal(partial.lines.find(line => line.id === smallLine).remaining, 4);
    const backOrderId = partial.back_order_id;
    const backOrderPath = `back-orders/${backOrderId}`;
    assert.ok(backOrderId);
    assert.equal((await request('back-orders/summary', staff)).data.pending, 1);
    assert.equal((await receive([{ orderLineId: smallLine, quantity: 1 }], { backOrderId: backOrderId + 100 })).status, 409);
    const delivered = [{ orderLineId: smallLine, quantity: 4 }];
    const competing = await Promise.all([
      receive(delivered, { backOrderId, requestId: 'test-receiving-race-one' }),
      receive(delivered, { backOrderId, requestId: 'test-receiving-race-two' })
    ]);
    assert.deepEqual(competing.map(result => result.status).sort(), [201, 409]);
    assert.equal((await readOrder()).back_order_id, backOrderId);
    assert.deepEqual(await readStock(), [10, 0]);
    const final = await receive([{ orderLineId: largeLine, quantity: 3 }], { backOrderId });
    assert.equal(final.status, 201);
    assert.equal((await readOrder()).status, 'received');
    assert.equal((await request(backOrderPath, staff)).data.record.status, 'closed');
    assert.deepEqual(await readStock(), [10, 3]);
    assert.equal((await request('back-orders/summary', staff)).data.pending, 0);
    assert.equal((await request(`receipts?orderId=${orderId}`, staff)).data.records.length, 3);

    const whole = (await createOrder([{ variantId: small, quantity: 1 }, { variantId: large, quantity: 1 }])).data.id;
    const wholeRecord = (await request(`purchase-orders/${whole}`, staff)).data.record;
    const full = await request('receipts', { ...staff, body: {
      orderId: whole, lines: wholeRecord.lines.map(line => ({ orderLineId: line.id, quantity: 1 }))
    } });
    assert.equal(full.status, 201);
    assert.equal((await request(`purchase-orders/${whole}`, staff)).data.record.back_order_id, null);
    assert.deepEqual(await readStock(), [11, 4]);
  });

  await t.test('issues and returns stock, preserves cadet kit history and audits corrections', async () => {
    const admin = { cookie: adminCookie };
    const login = await request('login', { body: { username: credentials.username, password: 'ReplacementStaff!456' } });
    const staff = { cookie: login.cookie };
    const { id: supplier } = (await request('suppliers?q=Ledger%20supplier', staff)).data.records[0];
    const { id: item } = (await request(`catalog?supplierId=${supplier}`, staff)).data.records[0];
    const [small, large] = (await request(`variants?itemId=${item}`, staff)).data.records;
    const cadet = { first_name: 'Quinn', last_name: 'Fixture', service_number: 'KIT-101', status: 'active' };
    const { id: cadetId } = (await request('cadets', { ...admin, body: cadet })).data;
    const sizes = async () => (await request(`inventory-stock/${item}/sizes`, staff)).data.records.map(row => row.quantity);
    const readKit = async () => (await request(`cadet-kit/${cadetId}`, staff)).data.record;
    const issueBody = { cadetId, requestId: 'test-uniform-issue-0001', lines: [
      { variantId: small.id, quantity: 1 }, { variantId: small.id, quantity: 1 }
    ] };
    const issue = await request('issues', { ...staff, body: issueBody });
    assert.equal(issue.status, 201);
    assert.deepEqual(await request('issues', { ...staff, body: issueBody }), issue);
    assert.deepEqual(await sizes(), [9, 4]);
    assert.equal((await readKit()).unit_count, 2);
    assert.equal((await readKit()).line_count, 1);

    const returned = await request('supplier-returns', { ...staff, body: { supplierId: supplier, lines: [
      { variantId: small.id, quantity: 1 }
    ] } });
    assert.equal(returned.status, 201);
    assert.deepEqual(await sizes(), [8, 4]);
    const issuePath = `issues/${issue.data.id}`;
    assert.equal((await request(`${issuePath}/reverse`, { ...staff, body: { reason: 'Correction' } })).status, 403);
    assert.equal((await request(`cadets/${cadetId}`, { ...admin, body: { ...cadet, first_name: 'Updated' } })).status, 200);
    assert.equal((await readKit()).name, 'Updated Fixture');
    assert.equal((await request(issuePath, staff)).data.record.party_name, 'Quinn Fixture');
    const correction = { reason: 'Incorrect recipient', requestId: 'test-uniform-reverse-0001' };
    const reversal = await request(`${issuePath}/reverse`, { ...admin, body: correction });
    assert.equal(reversal.status, 201);
    assert.deepEqual(await request(`${issuePath}/reverse`, { ...admin, body: correction }), reversal);
    assert.equal((await request(issuePath, staff)).data.record.reversal_reason, correction.reason);
    assert.deepEqual(await sizes(), [10, 4]);
    assert.equal((await readKit()).unit_count, 0);
    assert.equal((await readKit()).issue_count, 0);

    const oversize = await request('issues', { ...staff, body: { cadetId, lines: [
      { variantId: small.id, quantity: 1 }, { variantId: large.id, quantity: 5 }
    ] } });
    assert.equal(oversize.status, 409);
    assert.deepEqual(await sizes(), [10, 4]);
    const competing = await Promise.all([1, 2].map(attempt => request('issues', { ...staff, body: {
      cadetId, requestId: `test-uniform-race-${attempt}`, lines: [{ variantId: small.id, quantity: 6 }]
    } })));
    assert.deepEqual(competing.map(result => result.status).sort(), [201, 409]);
    assert.deepEqual(await sizes(), [4, 4]);

    const oldest = DB.database.prepare("SELECT id, order_id FROM inventory_transactions WHERE kind = 'receipt' ORDER BY id LIMIT 1").get();
    assert.equal((await request(`receipts/${oldest.id}/reverse`, { ...admin, body: { reason: 'Incorrect delivery' } })).status, 409);
    assert.deepEqual(await sizes(), [4, 4]);
    const winner = competing.find(result => result.status === 201).data.id;
    assert.equal((await request(`issues/${winner}/reverse`, { ...admin, body: { reason: 'Duplicate issue docket' } })).status, 201);
    assert.equal((await request(`receipts/${oldest.id}/reverse`, { ...admin, body: { reason: 'Incorrect delivery' } })).status, 201);
    const reopened = (await request(`purchase-orders/${oldest.order_id}`, staff)).data.record;
    assert.equal(reopened.status, 'partial');
    assert.equal(reopened.editable, 0);
    assert.equal((await request(`back-orders/${reopened.back_order_id}`, staff)).data.record.status, 'open');
    assert.deepEqual(await sizes(), [4, 4]);
    assert.equal((await request(`supplier-returns/${returned.data.id}/reverse`, { ...admin, body: { reason: 'Return withdrawn' } })).status, 201);
    assert.deepEqual(await sizes(), [5, 4]);
    const movements = (await request(`inventory-stock/${item}/movements`, staff)).data.records;
    assert.ok(movements.some(row => row.kind === 'reversal' && row.original_code));

    const extra = await request('purchase-orders', { ...staff, body: { supplierId: supplier, lines: [{ variantId: small.id, quantity: 1 }] } });
    const cancelPath = `purchase-orders/${extra.data.id}/cancel`;
    assert.equal((await request(cancelPath, { ...staff, body: { reason: 'Duplicate order' } })).status, 403);
    assert.equal((await request(cancelPath, { ...admin, body: { reason: 'Duplicate order' } })).status, 200);
    const cancelled = (await request(`purchase-orders/${extra.data.id}`, staff)).data.record;
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancellation_reason, 'Duplicate order');
    assert.equal((await request('receipts', { ...staff, body: {
      orderId: extra.data.id, lines: [{ orderLineId: cancelled.lines[0].id, quantity: 1 }]
    } })).status, 409);

    assert.equal((await request('opening-balances', staff)).status, 403);
    const { id: legacyId } = (await request('opening-balances?q=v1-stock', admin)).data.records[0];
    const opening = { legacyId, variantId: small.id, notes: 'Matched catalog size', requestId: 'test-opening-balance-0001' };
    const posted = await request('opening-balances', { ...admin, body: opening });
    assert.equal(posted.status, 201);
    assert.deepEqual(await request('opening-balances', { ...admin, body: opening }), posted);
    assert.equal((await request('opening-balances', { ...admin, body: { ...opening, requestId: 'test-opening-balance-0002' } })).status, 409);
    assert.deepEqual(await sizes(), [17, 4]);
    assert.equal(DB.database.prepare('SELECT quantity FROM stock WHERE id = ?').get(legacyId).quantity, 12);

    const kitIssue = await request('issues', { ...staff, body: { cadetId, lines: [
      { variantId: small.id, quantity: 2 }, { variantId: large.id, quantity: 1 }
    ] } });
    assert.equal(kitIssue.status, 201);
    assert.deepEqual(await sizes(), [15, 3]);
    assert.equal((await readKit()).unit_count, 3);
    assert.equal((await readKit()).line_count, 2);
  });
});
