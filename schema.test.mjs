import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { MANAGEMENT_SCHEMA } from './schema.js';

// Exercise the real schema against isolated SQLite, never the live D1 database.
// Foreign keys are enabled explicitly; Cloudflare runtime/build behavior is not
// emulated by these constraint and relationship checks.
function database(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT);
    INSERT INTO users VALUES (1, 'existing.admin', 'existing-password-hash')`);
  for (const statement of MANAGEMENT_SCHEMA) db.exec(statement);
  return db;
}

test('management schema is additive and can run again without losing records', t => {
  const db = database(t);
  db.exec("INSERT INTO stock (reference, description, quantity) VALUES ('SKU-1', 'Uniform item', 10)");
  for (const statement of MANAGEMENT_SCHEMA) db.exec(statement);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
  for (const name of ['staff', 'cadets', 'stock', 'orders']) assert.ok(names.includes(name));
  assert.equal(db.prepare('SELECT quantity FROM stock').get().quantity, 10);
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE id = 1').get().password_hash, 'existing-password-hash');
});

test('linked orders preserve history and do not automatically alter stock', t => {
  const db = database(t);
  db.exec(`INSERT INTO staff (user_id, service_number, first_name, last_name)
      VALUES (1, 'S001', 'Staff', 'Example');
    INSERT INTO cadets (service_number, first_name, last_name)
      VALUES ('C001', 'Cadet', 'Example');
    INSERT INTO stock (reference, description, quantity) VALUES ('SKU-1', 'Uniform item', 10);
    INSERT INTO orders (order_number, stock_id, quantity, order_type, status, cadet_id, staff_id, created_by_user_id)
      VALUES ('ORD-1', 1, 2, 'issue', 'fulfilled', 1, 1, 1)`);
  assert.equal(db.prepare('SELECT quantity FROM stock WHERE id = 1').get().quantity, 10);
  assert.throws(() => db.exec('DELETE FROM stock WHERE id = 1'), /FOREIGN KEY/);
  db.exec('DELETE FROM users WHERE id = 1');
  assert.equal(db.prepare('SELECT user_id FROM staff WHERE id = 1').get().user_id, null);
  assert.equal(db.prepare('SELECT created_by_user_id FROM orders WHERE id = 1').get().created_by_user_id, null);
  db.exec('DELETE FROM staff WHERE id = 1; DELETE FROM cadets WHERE id = 1');
  const order = db.prepare('SELECT * FROM orders WHERE id = 1').get();
  assert.equal(order.staff_id, null);
  assert.equal(order.cadet_id, null);
  assert.equal(order.quantity, 2);
  assert.throws(() => db.exec("INSERT INTO orders (order_number, stock_id, quantity, order_type) VALUES ('BAD-LINK', 999, 1, 'issue')"), /FOREIGN KEY/);
});

test('invalid quantities, statuses, blank names and duplicate identifiers are rejected', t => {
  const db = database(t);
  assert.throws(() => db.exec("INSERT INTO staff (first_name, last_name) VALUES ('', 'Example')"));
  assert.throws(() => db.exec("INSERT INTO cadets (first_name, last_name, status) VALUES ('Cadet', 'Example', 'unknown')"));
  db.exec("INSERT INTO staff (service_number, first_name, last_name) VALUES ('S001', 'Staff', 'Example')");
  assert.throws(() => db.exec("INSERT INTO staff (service_number, first_name, last_name) VALUES ('s001', 'Other', 'Example')"));
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
