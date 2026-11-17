// Additive D1/SQLite schema for the future management pages. Statements run in
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
  'CREATE INDEX IF NOT EXISTS orders_status_created_at ON orders(status, created_at)'
];

// updated_at is initialized on insert. Future write endpoints must update it
// explicitly; automatic timestamp/inventory triggers are intentionally absent.
