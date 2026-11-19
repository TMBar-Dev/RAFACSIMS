import { INVENTORY_SCHEMA } from './inventory-schema.js';

// Additive D1/SQLite schema for the management pages. Statements run in
// order after the existing users table is created. Repeated initialization does
// not drop tables, overwrite records or reset account passwords.
// CREATE IF NOT EXISTS is not a migration: later column changes need a separate
// reviewed migration rather than editing these declarations alone.
export const MANAGEMENT_SCHEMA = [
  // Staff profiles and sign-in accounts are separate. Profiles may exist without
  // a login; deleting a login unlinks its profile rather than deleting it.
  `CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    service_number TEXT COLLATE NOCASE UNIQUE
      CHECK(service_number IS NULL OR length(trim(service_number)) > 0),
    first_name TEXT NOT NULL CHECK(length(trim(first_name)) > 0),
    last_name TEXT NOT NULL CHECK(length(trim(last_name)) > 0),
    rank TEXT NOT NULL DEFAULT '',
    appointment TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  // Names are required; a service number and joining date can be filled later.
  // Dates use YYYY-MM-DD, not a locale-dependent date string or Unix timestamp.
  `CREATE TABLE IF NOT EXISTS cadets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_number TEXT COLLATE NOCASE UNIQUE
      CHECK(service_number IS NULL OR length(trim(service_number)) > 0),
    first_name TEXT NOT NULL CHECK(length(trim(first_name)) > 0),
    last_name TEXT NOT NULL CHECK(length(trim(last_name)) > 0),
    rank TEXT NOT NULL DEFAULT '',
    flight TEXT NOT NULL DEFAULT '',
    date_joined TEXT CHECK(date_joined IS NULL OR
      (date(date_joined, '+0 days') IS NOT NULL AND date(date_joined, '+0 days') = date_joined)),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'left')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  // Each size/variant can have its own unique reference. Database constraints
  // reject fractional and negative quantities even for direct SQL inserts.
  `CREATE TABLE IF NOT EXISTS stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(reference)) > 0),
    description TEXT NOT NULL CHECK(length(trim(description)) > 0),
    category TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 0 CHECK(typeof(quantity) = 'integer' AND quantity >= 0),
    reorder_level INTEGER NOT NULL DEFAULT 0 CHECK(typeof(reorder_level) = 'integer' AND reorder_level >= 0),
    location TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  // Initial model: one stock item/quantity per order, with optional recipient,
  // handling staff member and creator links. Keep historical orders if linked
  // people/accounts are deleted; referenced stock cannot be deleted.
  // There are no inventory triggers: changing status does NOT adjust stock.
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(order_number)) > 0),
    stock_id INTEGER NOT NULL REFERENCES stock(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK(typeof(quantity) = 'integer' AND quantity > 0),
    order_type TEXT NOT NULL CHECK(order_type IN ('issue', 'return', 'restock')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'fulfilled', 'cancelled')),
    cadet_id INTEGER REFERENCES cadets(id) ON DELETE SET NULL,
    staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  // Index child keys for lookups and FK checks when a referenced row is removed.
  'CREATE INDEX IF NOT EXISTS orders_stock_id ON orders(stock_id)',
  'CREATE INDEX IF NOT EXISTS orders_cadet_id ON orders(cadet_id)',
  'CREATE INDEX IF NOT EXISTS orders_staff_id ON orders(staff_id)',
  'CREATE INDEX IF NOT EXISTS orders_created_by_user_id ON orders(created_by_user_id)',
  'CREATE INDEX IF NOT EXISTS orders_status_created_at ON orders(status, created_at)',
  // Purchase orders use their own tables so the original stock and order
  // records remain available for reconciliation when receiving is added.
  `CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) > 0),
    address TEXT NOT NULL DEFAULT '',
    contact_person TEXT NOT NULL DEFAULT '',
    contact_number TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('active', 'inactive'))
  )`,
  `CREATE TABLE IF NOT EXISTS catalog_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) > 0),
    description TEXT NOT NULL DEFAULT '',
    uniform_type TEXT NOT NULL CHECK(uniform_type IN ('blue', 'green')),
    status TEXT NOT NULL CHECK(status IN ('active', 'inactive')),
    UNIQUE(supplier_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS catalog_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES catalog_items(id),
    size TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(size)) > 0),
    status TEXT NOT NULL CHECK(status IN ('active', 'inactive')),
    UNIQUE(item_id, size)
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT GENERATED ALWAYS AS ('PO-' || printf('%04d', id)) STORED UNIQUE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    supplier_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'partial', 'received')),
    notes TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    version INTEGER NOT NULL DEFAULT 1,
    creation_key TEXT NOT NULL UNIQUE,
    write_token TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
    variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
    item_name TEXT NOT NULL,
    size TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 1000000),
    UNIQUE(order_id, variant_id)
  )`,
  'CREATE INDEX IF NOT EXISTS purchase_orders_status ON purchase_orders(status)',
  'CREATE INDEX IF NOT EXISTS purchase_orders_supplier ON purchase_orders(supplier_id)',
  'CREATE INDEX IF NOT EXISTS purchase_order_lines_variant ON purchase_order_lines(variant_id)',
  // Side tables add concurrency metadata to existing databases without
  // rebuilding registers or rewriting historical purchase orders.
  `CREATE TABLE IF NOT EXISTS register_versions (
    register_name TEXT NOT NULL,
    record_id INTEGER NOT NULL,
    version INTEGER NOT NULL CHECK(version > 1),
    PRIMARY KEY (register_name, record_id)
  )`,
  ...['cadets', 'suppliers', 'catalog_items', 'catalog_variants'].map(table =>
    `CREATE TRIGGER IF NOT EXISTS bump_${table}_version AFTER UPDATE ON ${table} BEGIN
      INSERT INTO register_versions (register_name, record_id, version) VALUES ('${table}', NEW.id, 2)
      ON CONFLICT (register_name, record_id) DO UPDATE SET version = version + 1;
    END`),
  `CREATE TABLE IF NOT EXISTS purchase_order_requests (
    order_id INTEGER PRIMARY KEY REFERENCES purchase_orders(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL
  )`,
  ...INVENTORY_SCHEMA
];

// Write handlers update timestamps explicitly. The stock-movement trigger
// validates balances at insert time, leaving posting and status changes to the batch.
