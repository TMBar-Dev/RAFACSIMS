import { constraintError, fail, integer, MAX_LINES, MAX_QUANTITY, pageRows, queryPage, text } from './management.js';

const KINDS = { receipts: 'receipt', issues: 'issue', 'supplier-returns': 'return', 'opening-balances': 'opening' };
const PAGE_LIMIT = 26;

export function inventoryRoute(path) {
  const cancellation = /^\/api\/purchase-orders\/(\d+)\/cancel$/.exec(path);
  if (cancellation) return { resource: 'purchase-orders', detail: cancellation[1], action: 'cancel' };
  const match = /^\/api\/(receipts|back-orders|inventory-stock|issues|supplier-returns|cadet-kit|opening-balances)(?:\/(\d+|summary)(?:\/(reverse|sizes|movements))?)?$/.exec(path);
  if (!match) return null;
  const [, resource, detail, action] = match;
  if (detail === 'summary' && (resource !== 'back-orders' || action)) return null;
  if (action === 'reverse' && !['receipts', 'issues', 'supplier-returns'].includes(resource)) return null;
  if (['sizes', 'movements'].includes(action) && resource !== 'inventory-stock') return null;
  return { resource, detail, action };
}

const TRANSACTION_COLUMNS = `t.id, t.code, t.kind, t.order_id, t.back_order_id, o.code AS order_code, b.code AS back_order_code,
  t.cadet_id, t.supplier_id, t.party_name, t.actor_name, t.notes, t.created_at,
  r.code AS reversal_code, r.actor_name AS reversed_by, r.notes AS reversal_reason, r.created_at AS reversed_at`;
const TRANSACTION_TABLES = `FROM inventory_transactions t
  LEFT JOIN purchase_orders o ON o.id = t.order_id
  LEFT JOIN back_orders b ON b.id = t.back_order_id
  LEFT JOIN inventory_transactions r ON r.original_id = t.id`;

async function readTransactions(db, kind, id, url) {
  if (id) {
    const [header, lines] = await db.batch([
      db.prepare(`SELECT ${TRANSACTION_COLUMNS} ${TRANSACTION_TABLES} WHERE t.id = ? AND t.kind = ?`).bind(id, kind),
      db.prepare(`SELECT id, variant_id, item_name, size, abs(quantity_delta) AS quantity
        FROM stock_movements WHERE transaction_id = ? ORDER BY id`).bind(id)
    ]);
    if (!header.results[0]) fail('Transaction not found.', 404);
    return { record: { ...header.results[0], lines: lines.results } };
  }
  const { after, search } = queryPage(url);
  const order = url.searchParams.has('orderId') ? integer(Number(url.searchParams.get('orderId')), 'Order ID') : null;
  const cadet = url.searchParams.has('cadetId') ? integer(Number(url.searchParams.get('cadetId')), 'Cadet ID') : null;
  const result = await db.prepare(`SELECT ${TRANSACTION_COLUMNS},
    (SELECT count(*) FROM stock_movements WHERE transaction_id = t.id) AS line_count,
    (SELECT sum(abs(quantity_delta)) FROM stock_movements WHERE transaction_id = t.id) AS unit_count
    ${TRANSACTION_TABLES} WHERE t.kind = ? AND (? IS NULL OR t.id < ?)
    AND (? IS NULL OR t.order_id = ?) AND (? IS NULL OR t.cadet_id = ?)
    AND instr(lower(t.code || ' ' || coalesce(o.code, '') || ' ' || t.party_name || ' ' || t.actor_name || ' ' || t.notes), lower(?)) > 0
    ORDER BY t.id DESC LIMIT ?`).bind(kind, after, after, order, order, cadet, cadet, search, PAGE_LIMIT).all();
  return pageRows(result.results);
}

async function readBackOrders(db, detail, url) {
  if (detail === 'summary') {
    return db.prepare(`SELECT count(*) AS pending FROM back_orders b
      JOIN purchase_orders o ON o.id = b.order_id WHERE o.status != 'received'`).first();
  }
  const columns = `b.id, b.code, b.order_id, b.created_at, o.code AS order_code, o.supplier_name,
    CASE WHEN o.status = 'received' THEN 'closed' ELSE 'open' END AS status`;
  if (detail) {
    const id = integer(Number(detail), 'Back order ID');
    const [header, lines] = await db.batch([
      db.prepare(`SELECT ${columns} FROM back_orders b JOIN purchase_orders o ON o.id = b.order_id WHERE b.id = ?`).bind(id),
      db.prepare(`SELECT l.id, l.item_name, l.size, l.quantity, l.received, l.remaining
        FROM back_orders b JOIN purchase_line_balances l ON l.order_id = b.order_id
        WHERE b.id = ? ORDER BY l.id`).bind(id)
    ]);
    if (!header.results[0]) fail('Back order not found.', 404);
    return { record: { ...header.results[0], lines: lines.results } };
  }
  const { after, search } = queryPage(url);
  const result = await db.prepare(`SELECT ${columns},
    (SELECT count(*) FROM purchase_line_balances l WHERE l.order_id = o.id AND l.remaining > 0) AS line_count,
    (SELECT sum(remaining) FROM purchase_line_balances l WHERE l.order_id = o.id) AS unit_count
    FROM back_orders b JOIN purchase_orders o ON o.id = b.order_id
    WHERE (? IS NULL OR b.id < ?)
    AND instr(lower(b.code || ' ' || o.code || ' ' || o.supplier_name), lower(?)) > 0
    ORDER BY b.id DESC LIMIT ?`).bind(after, after, search, PAGE_LIMIT).all();
  return pageRows(result.results);
}

async function readStock(db, id, action, url) {
  const { after, search } = queryPage(url);
  if (action === 'sizes') {
    const result = await db.prepare(`SELECT v.id, v.size, v.status, coalesce(b.quantity, 0) AS quantity
      FROM catalog_variants v LEFT JOIN variant_stock_balances b ON b.variant_id = v.id
      WHERE v.item_id = ? AND v.id > ? AND instr(lower(v.size), lower(?)) > 0
      ORDER BY v.id LIMIT ?`).bind(id, after ?? 0, search, PAGE_LIMIT).all();
    return pageRows(result.results);
  }
  if (action === 'movements') {
    const result = await db.prepare(`SELECT m.id, m.size, m.quantity_delta, t.id AS transaction_id, t.kind, t.code,
      t.actor_name, t.notes, t.created_at, original.code AS original_code
      FROM stock_movements m JOIN catalog_variants v ON v.id = m.variant_id
      JOIN inventory_transactions t ON t.id = m.transaction_id
      LEFT JOIN inventory_transactions original ON original.id = t.original_id
      WHERE v.item_id = ? AND (? IS NULL OR m.id < ?)
      AND instr(lower(t.code || ' ' || m.size || ' ' || t.actor_name), lower(?)) > 0
      ORDER BY m.id DESC LIMIT ?`).bind(id, after, after, search, PAGE_LIMIT).all();
    return pageRows(result.results);
  }
  const result = await db.prepare(`SELECT i.id, i.name, i.description, i.uniform_type, i.status, s.name AS supplier_name,
    coalesce((SELECT sum(b.quantity) FROM catalog_variants v
      JOIN variant_stock_balances b ON b.variant_id = v.id WHERE v.item_id = i.id), 0) AS quantity
    FROM catalog_items i JOIN suppliers s ON s.id = i.supplier_id
    WHERE (? IS NULL OR i.id = ?) AND i.id > ?
    AND instr(lower(i.name || ' ' || i.description || ' ' || s.name), lower(?)) > 0
    ORDER BY i.id LIMIT ?`).bind(id, id, after ?? 0, search, PAGE_LIMIT).all();
  if (!id) return pageRows(result.results);
  if (!result.results[0]) fail('Stock item not found.', 404);
  return { record: result.results[0] };
}

async function readCadetKit(db, id, url) {
  const { after, search } = queryPage(url);
  // Totals use unreversed issues. Recipients with historical issues remain
  // searchable even after leaving, and the issue details keep the old label.
  const result = await db.prepare(`SELECT c.id, c.first_name || ' ' || c.last_name AS name, c.status,
    (SELECT count(*) FROM inventory_transactions t WHERE t.kind = 'issue' AND t.cadet_id = c.id
      AND NOT EXISTS (SELECT 1 FROM inventory_transactions r WHERE r.original_id = t.id)) AS issue_count,
    (SELECT count(*) FROM stock_movements m JOIN inventory_transactions t ON t.id = m.transaction_id
      WHERE t.kind = 'issue' AND t.cadet_id = c.id
      AND NOT EXISTS (SELECT 1 FROM inventory_transactions r WHERE r.original_id = t.id)) AS line_count,
    coalesce((SELECT sum(-m.quantity_delta) FROM stock_movements m JOIN inventory_transactions t ON t.id = m.transaction_id
      WHERE t.kind = 'issue' AND t.cadet_id = c.id
      AND NOT EXISTS (SELECT 1 FROM inventory_transactions r WHERE r.original_id = t.id)), 0) AS unit_count
    FROM cadets c WHERE (? IS NULL OR c.id = ?) AND c.id > ?
    AND EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.kind = 'issue' AND t.cadet_id = c.id)
    AND instr(lower(c.first_name || ' ' || c.last_name), lower(?)) > 0
    ORDER BY c.id LIMIT ?`).bind(id, id, after ?? 0, search, PAGE_LIMIT).all();
  if (!id) return pageRows(result.results);
  if (!result.results[0]) fail('Cadet kit history not found.', 404);
  return { record: result.results[0] };
}

async function readLegacyStock(db, url) {
  const { after, search } = queryPage(url);
  const result = await db.prepare(`SELECT s.id, s.reference, s.description, s.size, s.quantity FROM stock s
    WHERE s.id > ? AND s.quantity > 0
    AND NOT EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.legacy_stock_id = s.id)
    AND instr(lower(s.reference || ' ' || s.description || ' ' || s.size), lower(?)) > 0
    ORDER BY s.id LIMIT ?`).bind(after ?? 0, search, PAGE_LIMIT).all();
  return pageRows(result.results);
}

export function readInventory(db, { resource, detail, action }, url) {
  if (action === 'reverse' || action === 'cancel') fail('Use POST for this action.', 405);
  if (resource === 'back-orders') return readBackOrders(db, detail, url);
  const id = detail ? integer(Number(detail), 'Record ID') : null;
  if (resource === 'inventory-stock') return readStock(db, id, action, url);
  if (resource === 'cadet-kit') return readCadetKit(db, id, url);
  if (resource === 'opening-balances' && !id) return readLegacyStock(db, url);
  return readTransactions(db, KINDS[resource], id, url);
}

function transactionLines(body, receipt) {
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > MAX_LINES)
    fail(`Provide between 1 and ${MAX_LINES} lines.`);
  const totals = new Map();
  for (const line of body.lines) {
    const id = integer(receipt ? line?.orderLineId : line?.variantId, receipt ? 'Order line' : 'Item size');
    const quantity = receipt && line?.quantity === 0 ? 0 : integer(line?.quantity, 'Quantity', MAX_QUANTITY);
    if (receipt && totals.has(id)) fail('Provide one quantity per order line.');
    const total = (totals.get(id) ?? 0) + quantity;
    totals.set(id, total === 0 ? 0 : integer(total, 'Combined quantity', MAX_QUANTITY));
  }
  return [...totals].map(([id, quantity]) => ({ id, quantity })).sort((a, b) => a.id - b.id);
}

async function requestIdentity(body, user, kind, input) {
  const token = crypto.randomUUID();
  const requestId = body.requestId ?? token;
  if (typeof requestId !== 'string' || !/^[a-z0-9-]{16,64}$/i.test(requestId)) fail('Invalid transaction request ID.');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
  return {
    token,
    key: `${user.id}:${kind}:${requestId}`,
    fingerprint: Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
  };
}

const HEADER_TAIL = `ON CONFLICT(request_key) DO NOTHING RETURNING id, code`;

async function postingResult(db, identity, statements, unavailable) {
  let saved;
  try {
    [saved] = await db.batch(statements);
  } catch (error) {
    const details = constraintError(error);
    if (/insufficient stock/i.test(details)) fail('Insufficient stock for one or more item sizes.', 409);
    if (/receipt quantity exceeds order balance/i.test(details)) fail('A quantity exceeds the remaining order balance. Reload the order.', 409);
    if (/NOT NULL constraint failed: stock_movements\./i.test(details))
      fail('One or more lines are unavailable or belong to another record.', 409);
    throw error;
  }
  if (saved.results[0]) return saved.results[0];
  const prior = await db.prepare('SELECT id, code, request_fingerprint FROM inventory_transactions WHERE request_key = ?')
    .bind(identity.key).first();
  if (!prior) fail(unavailable, 409);
  if (prior.request_fingerprint !== identity.fingerprint) fail('This request ID already posted a different transaction. Open its details before retrying.', 409);
  return { id: prior.id, code: prior.code };
}

function refreshOrder(db, token) {
  // Derive status from net posted receipts after every line has been recorded.
  // A full multi-line delivery therefore never creates a transient back order.
  return [
    db.prepare(`UPDATE purchase_orders SET status = CASE
        WHEN NOT EXISTS (SELECT 1 FROM purchase_line_balances l WHERE l.order_id = purchase_orders.id AND l.remaining > 0)
          THEN 'received'
        WHEN EXISTS (SELECT 1 FROM purchase_line_balances l WHERE l.order_id = purchase_orders.id AND l.received > 0)
          THEN 'partial' ELSE 'pending' END,
        version = version + 1, updated_at = unixepoch()
      WHERE id = (SELECT order_id FROM inventory_transactions WHERE write_token = ?)`).bind(token),
    db.prepare(`INSERT INTO back_orders (order_id)
      SELECT o.id FROM purchase_orders o JOIN inventory_transactions t ON t.order_id = o.id
      WHERE t.write_token = ? AND o.status = 'partial' ON CONFLICT(order_id) DO NOTHING`).bind(token)
  ];
}

async function postReceipt(db, body, user) {
  const order = integer(body.orderId, 'Purchase order');
  const backOrder = body.backOrderId == null ? null : integer(body.backOrderId, 'Back order');
  const notes = text(body.notes ?? '', 'Remarks', 1000);
  const lines = transactionLines(body, true).filter(line => line.quantity > 0);
  if (!lines.length) fail('Enter at least one received quantity.');
  const identity = await requestIdentity(body, user, 'receipt', [order, backOrder, notes, lines]);
  const header = db.prepare(`INSERT INTO inventory_transactions
      (kind, order_id, back_order_id, supplier_id, party_name, actor_id, actor_name, notes, request_key, request_fingerprint, write_token)
    SELECT 'receipt', o.id, ?, o.supplier_id, o.supplier_name, ?, ?, ?, ?, ?, ? FROM purchase_orders o
    WHERE o.id = ? AND o.status IN ('pending', 'partial')
      AND NOT EXISTS (SELECT 1 FROM purchase_order_cancellations c WHERE c.order_id = o.id)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM back_orders b WHERE b.id = ? AND b.order_id = o.id))
    ${HEADER_TAIL}`).bind(backOrder, user.id, user.username, notes, identity.key, identity.fingerprint, identity.token,
      order, backOrder, backOrder);
  const movements = db.prepare(`INSERT INTO stock_movements
      (transaction_id, variant_id, order_line_id, item_name, size, quantity_delta)
    SELECT t.id, l.variant_id, l.id, l.item_name, l.size, json_extract(input.value, '$.quantity')
    FROM inventory_transactions t CROSS JOIN json_each(?) input
    LEFT JOIN purchase_order_lines l ON l.id = json_extract(input.value, '$.id') AND l.order_id = t.order_id
    WHERE t.write_token = ?`).bind(JSON.stringify(lines), identity.token);
  return postingResult(db, identity, [header, movements, ...refreshOrder(db, identity.token)],
    'This order is unavailable or has no remaining units to receive.');
}

async function postOutbound(db, kind, body, user) {
  const issue = kind === 'issue';
  const party = integer(issue ? body.cadetId : body.supplierId, issue ? 'Cadet' : 'Supplier');
  const notes = text(body.notes ?? '', 'Remarks', 1000);
  const lines = transactionLines(body, false);
  const identity = await requestIdentity(body, user, kind, [party, notes, lines]);
  const source = issue
    ? { key: 'cadet_id', name: "first_name || ' ' || last_name", table: 'cadets' }
    : { key: 'supplier_id', name: 'name', table: 'suppliers' };
  const header = db.prepare(`INSERT INTO inventory_transactions
      (kind, ${source.key}, party_name, actor_id, actor_name, notes, request_key, request_fingerprint, write_token)
    SELECT ?, id, ${source.name}, ?, ?, ?, ?, ?, ? FROM ${source.table} WHERE id = ? AND status = 'active'
    ${HEADER_TAIL}`).bind(kind, user.id, user.username, notes, identity.key, identity.fingerprint, identity.token, party);
  const movements = db.prepare(`INSERT INTO stock_movements (transaction_id, variant_id, item_name, size, quantity_delta)
    SELECT t.id, CASE WHEN s.id IS NOT NULL THEN v.id END, i.name, v.size, -json_extract(input.value, '$.quantity')
    FROM inventory_transactions t CROSS JOIN json_each(?) input
    LEFT JOIN catalog_variants v ON v.id = json_extract(input.value, '$.id') AND v.status = 'active'
    LEFT JOIN catalog_items i ON i.id = v.item_id AND i.status = 'active'
    LEFT JOIN suppliers s ON s.id = i.supplier_id AND s.status = 'active'
      AND (t.supplier_id IS NULL OR s.id = t.supplier_id)
    WHERE t.write_token = ?`).bind(JSON.stringify(lines), identity.token);
  return postingResult(db, identity, [header, movements], issue ? 'Choose an active cadet.' : 'Choose an active supplier.');
}

async function postOpening(db, body, user) {
  const legacyId = integer(body.legacyId, 'Legacy stock record');
  const variantId = integer(body.variantId, 'Item size');
  const notes = text(body.notes ?? '', 'Mapping note', 1000, true);
  const identity = await requestIdentity(body, user, 'opening', [legacyId, variantId, notes]);
  const header = db.prepare(`INSERT INTO inventory_transactions
      (kind, legacy_stock_id, party_name, actor_id, actor_name, notes, request_key, request_fingerprint, write_token)
    SELECT 'opening', s.id, s.reference, ?, ?, ?, ?, ?, ? FROM stock s WHERE s.id = ? AND s.quantity > 0
      AND NOT EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.legacy_stock_id = s.id)
    ${HEADER_TAIL}`).bind(user.id, user.username, notes, identity.key, identity.fingerprint, identity.token, legacyId);
  const movement = db.prepare(`INSERT INTO stock_movements (transaction_id, variant_id, item_name, size, quantity_delta)
    SELECT t.id, CASE WHEN supplier.id IS NOT NULL THEN v.id END, i.name, v.size, s.quantity
    FROM inventory_transactions t JOIN stock s ON s.id = t.legacy_stock_id
    LEFT JOIN catalog_variants v ON v.id = ? AND v.status = 'active'
    LEFT JOIN catalog_items i ON i.id = v.item_id AND i.status = 'active'
    LEFT JOIN suppliers supplier ON supplier.id = i.supplier_id AND supplier.status = 'active'
    WHERE t.write_token = ?`).bind(variantId, identity.token);
  return postingResult(db, identity, [header, movement], 'This legacy stock record is unavailable or has already been mapped.');
}

async function reverseTransaction(db, kind, id, body, user) {
  const reason = text(body.reason, 'Reversal reason', 1000, true);
  const identity = await requestIdentity(body, user, 'reversal', [kind, id, reason]);
  const header = db.prepare(`INSERT INTO inventory_transactions
      (kind, order_id, back_order_id, cadet_id, supplier_id, party_name, actor_id, actor_name, notes,
       original_id, request_key, request_fingerprint, write_token)
    SELECT 'reversal', t.order_id, t.back_order_id, t.cadet_id, t.supplier_id, t.party_name, ?, ?, ?,
      t.id, ?, ?, ? FROM inventory_transactions t WHERE t.id = ? AND t.kind = ?
      AND NOT EXISTS (SELECT 1 FROM inventory_transactions r WHERE r.original_id = t.id)
    ${HEADER_TAIL}`).bind(user.id, user.username, reason, identity.key, identity.fingerprint, identity.token, id, kind);
  const movements = db.prepare(`INSERT INTO stock_movements
      (transaction_id, variant_id, order_line_id, item_name, size, quantity_delta)
    SELECT t.id, m.variant_id, m.order_line_id, m.item_name, m.size, -m.quantity_delta
    FROM inventory_transactions t JOIN stock_movements m ON m.transaction_id = t.original_id
    WHERE t.write_token = ?`).bind(identity.token);
  return postingResult(db, identity, [header, movements, ...refreshOrder(db, identity.token)],
    'This transaction is unavailable or has already been reversed.');
}

async function cancelOrder(db, id, body, user) {
  const reason = text(body.reason, 'Cancellation reason', 1000, true);
  const result = await db.prepare(`INSERT INTO purchase_order_cancellations (order_id, actor_id, actor_name, reason)
    SELECT o.id, ?, ?, ? FROM purchase_orders o WHERE o.id = ? AND o.status = 'pending'
      AND NOT EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.order_id = o.id)
    ON CONFLICT(order_id) DO NOTHING RETURNING order_id AS id`).bind(user.id, user.username, reason, id).first();
  if (result) return result;
  const existing = await db.prepare('SELECT order_id AS id, actor_id, reason FROM purchase_order_cancellations WHERE order_id = ?').bind(id).first();
  if (existing?.actor_id === user.id && existing.reason === reason) return { id };
  fail('Only a pending order with no receiving history can be cancelled.', 409);
}

export function writeInventory(db, { resource, detail, action }, body, user) {
  const id = detail ? integer(Number(detail), 'Record ID') : null;
  if (action === 'cancel') return cancelOrder(db, id, body, user);
  if (action === 'reverse') return reverseTransaction(db, KINDS[resource], id, body, user);
  if (!id && resource === 'receipts') return postReceipt(db, body, user);
  if (!id && resource === 'opening-balances') return postOpening(db, body, user);
  if (!id && ['issues', 'supplier-returns'].includes(resource)) return postOutbound(db, KINDS[resource], body, user);
  fail('Method not allowed.', 405);
}
