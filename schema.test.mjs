import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { MANAGEMENT_SCHEMA } from './schema.js';
import { initializeStaffSchema } from './staff-schema.js';

// Exercise the real schema against isolated SQLite, never the live D1 database.
// Foreign keys are enabled explicitly; Cloudflare runtime/build behavior is not
// emulated by these constraint and relationship checks.
function openDatabase(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function d1(db) {
  return {
    prepare(sql) {
      return {
        all: () => ({ results: db.prepare(sql).all() }),
        first: () => db.prepare(sql).get(),
        run: () => db.prepare(sql).run()
      };
    },
    batch(statements) {
      db.exec('BEGIN');
      try {
        statements.forEach(statement => statement.run());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

async function database(t) {
  const db = openDatabase(t);
  await initializeStaffSchema(d1(db));
  db.exec(`INSERT INTO staff (username, password_hash, role) VALUES ('existing.admin', 'existing-password-hash', 'admin')`);
  for (const statement of MANAGEMENT_SCHEMA) db.exec(statement);
  return db;
}

test('management schema is additive and can run again without losing records', async t => {
  const db = await database(t);
  db.exec("INSERT INTO stock (reference, description, quantity) VALUES ('SKU-1', 'Uniform item', 10)");
  await initializeStaffSchema(d1(db));
  for (const statement of MANAGEMENT_SCHEMA) db.exec(statement);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
  for (const name of ['staff', 'cadets', 'stock', 'orders']) assert.ok(names.includes(name));
  assert.ok(!names.includes('users'));
  assert.equal(db.prepare('SELECT quantity FROM stock').get().quantity, 10);
  assert.equal(db.prepare('SELECT password_hash FROM staff WHERE id = 1').get().password_hash, 'existing-password-hash');
});

test('linked orders preserve history and do not automatically alter stock', async t => {
  const db = await database(t);
  db.exec(`INSERT INTO cadets (service_number, first_name, last_name)
      VALUES ('C001', 'Cadet', 'Example');
    INSERT INTO stock (reference, description, quantity) VALUES ('SKU-1', 'Uniform item', 10);
    INSERT INTO orders (order_number, stock_id, quantity, order_type, status, cadet_id, staff_id, created_by_user_id)
      VALUES ('ORD-1', 1, 2, 'issue', 'fulfilled', 1, 1, 1)`);
  assert.equal(db.prepare('SELECT quantity FROM stock WHERE id = 1').get().quantity, 10);
  assert.throws(() => db.exec('DELETE FROM stock WHERE id = 1'), /FOREIGN KEY/);
  db.exec('DELETE FROM staff WHERE id = 1; DELETE FROM cadets WHERE id = 1');
  const order = db.prepare('SELECT * FROM orders WHERE id = 1').get();
  assert.equal(order.created_by_user_id, null);
  assert.equal(order.staff_id, null);
  assert.equal(order.cadet_id, null);
  assert.equal(order.quantity, 2);
  assert.throws(() => db.exec("INSERT INTO orders (order_number, stock_id, quantity, order_type) VALUES ('BAD-LINK', 999, 1, 'issue')"), /FOREIGN KEY/);
});

test('invalid quantities, statuses and duplicate identifiers are rejected', async t => {
  const db = await database(t);
  assert.throws(() => db.exec("INSERT INTO staff (password_hash) VALUES ('test-hash')"));
  assert.throws(() => db.exec("INSERT INTO staff (username, password_hash) VALUES ('EXISTING.ADMIN', 'test-hash')"));
  assert.throws(() => db.exec("INSERT INTO staff (username, password_hash, permissions) VALUES ('staff.example', 'test-hash', 1.5)"));
  assert.throws(() => db.exec("INSERT INTO staff (username, password_hash, permissions) VALUES ('staff.example', 'test-hash', 8)"));
  assert.throws(() => db.exec("INSERT INTO cadets (first_name, last_name, status) VALUES ('Cadet', 'Example', 'unknown')"));
  for (const quantity of [-1, 1.5]) {
    assert.throws(() => db.exec(`INSERT INTO stock (reference, description, quantity) VALUES ('BAD-${quantity}', 'Item', ${quantity})`));
  }
  assert.throws(() => db.exec("INSERT INTO stock (reference, description, reorder_level) VALUES ('BAD-LEVEL', 'Item', -1)"));
  db.exec("INSERT INTO stock (reference, description, quantity) VALUES ('SKU-1', 'Uniform item', 10)");
  for (const quantity of [0, -1, 1.5]) {
    assert.throws(() => db.exec(`INSERT INTO orders (order_number, stock_id, quantity, order_type) VALUES ('BAD-${quantity}', 1, ${quantity}, 'issue')`), /CHECK/);
  }
  assert.throws(() => db.exec("INSERT INTO orders (order_number, stock_id, quantity, order_type, status) VALUES ('BAD-STATUS', 1, 1, 'issue', 'unknown')"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO orders (order_number, stock_id, quantity, order_type) VALUES ('BAD-TYPE', 1, 1, 'unknown')"));
});

test('legacy migration preserves accounts, sessions, permissions and historical foreign keys', async t => {
  const db = openDatabase(t);
  db.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE staff (
      id INTEGER PRIMARY KEY,
      user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TRIGGER revoke_sessions_after_identity_edit
      AFTER UPDATE OF username, role ON users
      BEGIN DELETE FROM sessions WHERE user_id = NEW.id; END;
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    INSERT INTO users (id, username, password_hash, role, must_change_password, created_at)
      VALUES (7, 'linked.staff', 'stored-password-hash', 'user', 1, 1710000000),
             (12, 'unlinked.admin', 'different-password-hash', 'admin', 0, 1710000001);
    INSERT INTO staff VALUES (93, 7, 'Fixture', 'Staff', 'inactive'), (94, NULL, '-', '-', 'active');
    INSERT INTO orders VALUES (4, 93, 7);
    INSERT INTO sessions VALUES ('session-token-hash', 7)`);

  const binding = d1(db);
  // Two initializers can both see the old table before either runs its batch.
  await Promise.all([initializeStaffSchema(binding), initializeStaffSchema(binding)]);
  await initializeStaffSchema(binding);

  const linked = db.prepare('SELECT * FROM staff WHERE id = 7').get();
  assert.deepEqual({ ...linked }, {
    id: 7, username: 'linked.staff', password_hash: 'stored-password-hash', role: 'user',
    must_change_password: 1, created_at: 1710000000, permissions: 7
  });
  assert.equal(db.prepare('SELECT permissions FROM staff WHERE id = 12').get().permissions, 0);
  assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'users'").get(), undefined);
  assert.equal(db.prepare('SELECT count(*) AS total FROM legacy_staff_profiles').get().total, 2);
  assert.equal(db.prepare('SELECT token_hash FROM sessions WHERE user_id = 7').get().token_hash, 'session-token-hash');
  assert.deepEqual({ ...db.prepare('SELECT staff_id, created_by_user_id FROM orders WHERE id = 4').get() },
    { staff_id: 93, created_by_user_id: 7 });
  const references = Object.fromEntries(db.prepare('PRAGMA foreign_key_list(orders)').all().map(key => [key.from, key.table]));
  assert.deepEqual(references, { staff_id: 'legacy_staff_profiles', created_by_user_id: 'staff' });
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.exec("UPDATE staff SET username = 'renamed.staff' WHERE id = 7");
  assert.equal(db.prepare('SELECT token_hash FROM sessions WHERE user_id = 7').get(), undefined);
});

test('legacy account table migrates when no profile table exists', async t => {
  const db = openDatabase(t);
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT);
    INSERT INTO users VALUES (1, 'legacy.user', 'legacy-hash')`);
  await initializeStaffSchema(d1(db));
  assert.equal(db.prepare("SELECT permissions FROM staff WHERE username = 'legacy.user'").get().permissions, 0);
});
