// Posted transactions are append-only. A correction posts the opposite
// quantities and links back to the original transaction.
export const INVENTORY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS purchase_order_cancellations (
    order_id INTEGER PRIMARY KEY REFERENCES purchase_orders(id),
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE TABLE IF NOT EXISTS back_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT GENERATED ALWAYS AS ('BO-' || printf('%04d', id)) STORED UNIQUE,
    order_id INTEGER NOT NULL UNIQUE REFERENCES purchase_orders(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK(kind IN ('receipt', 'issue', 'return', 'opening', 'reversal')),
    code TEXT GENERATED ALWAYS AS (
      CASE kind WHEN 'receipt' THEN 'RCV-' WHEN 'issue' THEN 'ISSUE-' WHEN 'return' THEN 'R-'
        WHEN 'opening' THEN 'OPEN-' ELSE 'REV-' END || printf('%04d', id)
    ) STORED UNIQUE,
    order_id INTEGER REFERENCES purchase_orders(id),
    back_order_id INTEGER REFERENCES back_orders(id),
    cadet_id INTEGER REFERENCES cadets(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    party_name TEXT NOT NULL,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    original_id INTEGER UNIQUE REFERENCES inventory_transactions(id),
    legacy_stock_id INTEGER UNIQUE REFERENCES stock(id),
    request_key TEXT NOT NULL UNIQUE,
    request_fingerprint TEXT NOT NULL,
    write_token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES inventory_transactions(id),
    variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
    order_line_id INTEGER REFERENCES purchase_order_lines(id),
    item_name TEXT NOT NULL,
    size TEXT NOT NULL,
    quantity_delta INTEGER NOT NULL CHECK(typeof(quantity_delta) = 'integer' AND quantity_delta != 0),
    UNIQUE(transaction_id, variant_id)
  )`,
  'CREATE INDEX IF NOT EXISTS stock_movements_variant ON stock_movements(variant_id)',
  'CREATE INDEX IF NOT EXISTS stock_movements_order_line ON stock_movements(order_line_id)',
  'CREATE INDEX IF NOT EXISTS inventory_transactions_order ON inventory_transactions(order_id, id)',
  'CREATE INDEX IF NOT EXISTS inventory_transactions_cadet ON inventory_transactions(cadet_id, kind, id)',
  'CREATE INDEX IF NOT EXISTS inventory_transactions_kind ON inventory_transactions(kind, id)',
  `CREATE VIEW IF NOT EXISTS purchase_line_balances AS
    SELECT l.*, coalesce(sum(m.quantity_delta), 0) AS received,
      l.quantity - coalesce(sum(m.quantity_delta), 0) AS remaining
    FROM purchase_order_lines l LEFT JOIN stock_movements m ON m.order_line_id = l.id
    GROUP BY l.id`,
  `CREATE VIEW IF NOT EXISTS variant_stock_balances AS
    SELECT variant_id, sum(quantity_delta) AS quantity FROM stock_movements GROUP BY variant_id`,
  // These checks run inside the write transaction for each line. An issue and
  // a receipt reversal therefore compete for the same actual stock balance.
  `CREATE TRIGGER IF NOT EXISTS stock_movements_validate_insert
    BEFORE INSERT ON stock_movements BEGIN
      SELECT CASE WHEN NEW.variant_id IS NOT NULL AND NEW.quantity_delta < 0 AND
        coalesce((SELECT sum(quantity_delta) FROM stock_movements WHERE variant_id = NEW.variant_id), 0)
          + NEW.quantity_delta < 0 THEN RAISE(ABORT, 'insufficient stock') END;
      SELECT CASE WHEN NEW.order_line_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM purchase_line_balances l
        JOIN inventory_transactions t ON t.id = NEW.transaction_id
        WHERE l.id = NEW.order_line_id AND l.variant_id = NEW.variant_id AND l.order_id = t.order_id
          AND l.received + NEW.quantity_delta BETWEEN 0 AND l.quantity
      ) THEN RAISE(ABORT, 'receipt quantity exceeds order balance') END;
    END`
];
