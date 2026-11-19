export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

const PAGE_SIZE = 25;
export const MAX_LINES = 50;
export const MAX_QUANTITY = 1_000_000;

export function text(value, label, max, required = false) {
  if (typeof value !== 'string') fail(`${label} must be text.`);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value))
    fail(`${label} contains unsupported control characters.`);
  const trimmed = value.trim().normalize('NFC');
  if (trimmed.length > max || (required && !trimmed))
    fail(`${label} must contain ${required ? 1 : 0}–${max} characters.`);
  return trimmed;
}

function singleLine(value, label, max, required = false) {
  const result = text(value, label, max, required);
  if (/[\r\n\t\u2028\u2029]/.test(result)) fail(`${label} must be on one line.`);
  return result;
}

function choice(value, label, allowed) {
  if (!allowed.includes(value)) fail(`Choose a valid ${label}.`);
  return value;
}

export function integer(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    fail(`${label} must be a whole number between 1 and ${max}.`);
  return value;
}

function joiningDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value) fail('Enter a valid joining date.');
  return value;
}

// SQL identifiers come exclusively from this registry. Request values always
// travel as bindings, including filters and the text used for search.
const VARIANT_QUANTITY = 'coalesce((SELECT sum(quantity_delta) FROM stock_movements WHERE variant_id = r.id), 0)';
const REGISTERS = {
  cadets: {
    table: 'cadets',
    fields: 'r.id, r.service_number, r.first_name, r.last_name, r.rank, r.flight, r.date_joined, r.status',
    search: "r.first_name || ' ' || r.last_name || ' ' || coalesce(r.service_number, '') || ' ' || r.rank || ' ' || r.flight",
    values: body => ({
      service_number: singleLine(body.service_number ?? '', 'Service number', 40) || null,
      first_name: singleLine(body.first_name, 'First name', 100, true),
      last_name: singleLine(body.last_name, 'Last name', 100, true),
      rank: singleLine(body.rank ?? '', 'Rank', 80),
      flight: singleLine(body.flight ?? '', 'Flight', 80),
      date_joined: joiningDate(text(body.date_joined ?? '', 'Joining date', 10)),
      status: choice(body.status, 'status', ['active', 'inactive', 'left'])
    }),
    duplicate: 'That service number is already in use.'
  },
  suppliers: {
    table: 'suppliers',
    fields: 'r.id, r.name, r.address, r.contact_person, r.contact_number, r.status',
    search: "r.name || ' ' || r.contact_person || ' ' || r.contact_number",
    values: body => ({
      name: singleLine(body.name, 'Supplier name', 150, true),
      address: text(body.address ?? '', 'Address', 400),
      contact_person: singleLine(body.contact_person ?? '', 'Contact person', 100),
      contact_number: singleLine(body.contact_number ?? '', 'Contact number', 50),
      status: choice(body.status, 'status', ['active', 'inactive'])
    }),
    duplicate: 'That supplier name is already in use.'
  },
  catalog: {
    table: 'catalog_items',
    fields: 'r.id, r.supplier_id, r.name, r.description, r.uniform_type, r.status, s.name AS supplier_name',
    from: 'JOIN suppliers s ON s.id = r.supplier_id',
    active: "s.status = 'active'",
    filters: { supplierId: 'r.supplier_id' },
    search: "r.name || ' ' || r.description || ' ' || s.name || ' ' || r.uniform_type",
    values: (body, id) => ({
      ...(!id && { supplier_id: integer(body.supplier_id, 'Supplier') }),
      name: singleLine(body.name, 'Item name', 150, true),
      description: text(body.description ?? '', 'Description', 500),
      uniform_type: choice(body.uniform_type, 'uniform type', ['blue', 'green']),
      status: choice(body.status, 'status', ['active', 'inactive'])
    }),
    parent: { table: 'suppliers', key: 'supplier_id', label: 'supplier' },
    duplicate: 'That item name is already in use for this supplier.'
  },
  variants: {
    table: 'catalog_variants',
    fields: `r.id, r.item_id, r.size, r.status, i.name AS item_name, i.uniform_type, i.supplier_id,
      s.name AS supplier_name, ${VARIANT_QUANTITY} AS available`,
    from: 'JOIN catalog_items i ON i.id = r.item_id JOIN suppliers s ON s.id = i.supplier_id',
    active: "i.status = 'active' AND s.status = 'active'",
    inStock: `${VARIANT_QUANTITY} > 0`,
    filters: { supplierId: 'i.supplier_id', itemId: 'r.item_id' },
    search: "i.name || ' ' || r.size || ' ' || i.uniform_type || ' ' || s.name",
    values: (body, id) => ({
      ...(!id && { item_id: integer(body.item_id, 'Item'), size: singleLine(body.size, 'Size', 80, true) }),
      status: choice(body.status, 'status', ['active', 'inactive'])
    }),
    parent: { table: 'catalog_items', key: 'item_id', label: 'catalog item' },
    duplicate: 'That size already exists for this item.'
  }
};

export function managementRoute(path) {
  const match = /^\/api\/(cadets|suppliers|catalog|variants|purchase-orders)(?:\/(\d+|summary))?$/.exec(path);
  if (!match || (match[2] === 'summary' && match[1] !== 'purchase-orders')) return null;
  return { resource: match[1], detail: match[2] };
}

export function queryPage(url) {
  const cursor = url.searchParams.get('after');
  return {
    after: cursor === null ? null : integer(Number(cursor), 'Page cursor'),
    search: text(url.searchParams.get('q') ?? '', 'Search', 120)
  };
}

export function pageRows(rows) {
  const records = rows.slice(0, PAGE_SIZE);
  return { records, nextCursor: rows.length > PAGE_SIZE ? records.at(-1).id : null };
}

export function constraintError(error) {
  return [error.message, error.cause?.message].filter(Boolean).join(' ');
}

function registerVersion(config, idExpression) {
  return `coalesce((SELECT version FROM register_versions
    WHERE register_name = '${config.table}' AND record_id = ${idExpression}), 1)`;
}

async function readRegister(db, config, id, url, activeOnly) {
  const where = [];
  const binds = [];
  const from = `FROM ${config.table} r ${config.from ?? ''}`;
  const fields = `${config.fields}, ${registerVersion(config, 'r.id')} AS version`;
  if (activeOnly) {
    where.push("r.status = 'active'");
    if (config.active) where.push(config.active);
  }
  if (config.inStock && url.searchParams.get('inStock') === '1') where.push(config.inStock);
  if (id) {
    const record = await db.prepare(`SELECT ${fields} ${from}
      WHERE ${[...where, 'r.id = ?'].join(' AND ')}`).bind(id).first();
    if (!record) fail('Record not found.', 404);
    return { record };
  }

  const { after, search } = queryPage(url);
  where.push('r.id > ?', `instr(lower(${config.search}), lower(?)) > 0`);
  binds.push(after ?? 0, search);
  for (const [param, column] of Object.entries(config.filters ?? {})) {
    if (!url.searchParams.has(param)) continue;
    where.push(`${column} = ?`);
    binds.push(integer(Number(url.searchParams.get(param)), param));
  }
  const result = await db.prepare(`SELECT ${fields} ${from}
    WHERE ${where.join(' AND ')} ORDER BY r.id LIMIT ?`).bind(...binds, PAGE_SIZE + 1).all();
  return pageRows(result.results);
}

async function writeRegister(db, resource, id, body) {
  const config = REGISTERS[resource];
  const values = config.values(body, id);
  const columns = Object.keys(values);
  const args = Object.values(values);
  const parent = config.parent;
  if (!id && parent && !await db.prepare(`SELECT id FROM ${parent.table} WHERE id = ?`).bind(values[parent.key]).first())
    fail(`Choose an existing ${parent.label}.`);
  // Supplier/item ownership and variant sizes identify the things referenced
  // by orders. Edits keep those identities and use status to retire variants.
  const assignments = columns.map(column => `${column} = ?`);
  if (resource === 'cadets') assignments.push('updated_at = unixepoch()');
  const sql = id
    ? `UPDATE ${config.table} SET ${assignments.join(', ')}
        WHERE id = ? AND ${registerVersion(config, `${config.table}.id`)} = ? RETURNING id`
    : `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) RETURNING id`;
  if (id) args.push(id, integer(body.version, 'Record version'));
  try {
    const record = await db.prepare(sql).bind(...args).first();
    if (!record) {
      if (id && await db.prepare(`SELECT id FROM ${config.table} WHERE id = ?`).bind(id).first())
        fail('This record changed since you opened it. Cancel, refresh and reopen it before editing.', 409);
      fail('Record not found.', 404);
    }
    return { id: record.id };
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(constraintError(error))) fail(config.duplicate, 409);
    throw error;
  }
}

const ORDER_FIELDS = `id, code, supplier_id, supplier_name,
  CASE WHEN EXISTS (SELECT 1 FROM purchase_order_cancellations WHERE order_id = purchase_orders.id)
    THEN 'cancelled' ELSE status END AS status, notes, created_at, updated_at, version`;
// Even after reversing a receipt, keep the lines that its audit record points to.
const ORDER_UNPOSTED = `NOT EXISTS (SELECT 1 FROM inventory_transactions WHERE order_id = purchase_orders.id)
  AND NOT EXISTS (SELECT 1 FROM purchase_order_cancellations WHERE order_id = purchase_orders.id)`;

async function readOrders(db, detail, url) {
  if (detail === 'summary') {
    return db.prepare(`SELECT count(*) AS pending FROM purchase_orders o
      WHERE o.status IN ('pending', 'partial') AND NOT EXISTS (
        SELECT 1 FROM purchase_order_cancellations c WHERE c.order_id = o.id
      )`).first();
  }
  if (detail) {
    const id = integer(Number(detail), 'Order ID');
    const [header, lines] = await db.batch([
      db.prepare(`SELECT ${ORDER_FIELDS}, (status = 'pending' AND ${ORDER_UNPOSTED}) AS editable,
        (SELECT id FROM back_orders WHERE order_id = purchase_orders.id) AS back_order_id,
        (SELECT reason FROM purchase_order_cancellations WHERE order_id = purchase_orders.id) AS cancellation_reason,
        (SELECT actor_name FROM purchase_order_cancellations WHERE order_id = purchase_orders.id) AS cancelled_by
        FROM purchase_orders WHERE id = ?`).bind(id),
      db.prepare(`SELECT id, variant_id, item_name, size, quantity, received, remaining FROM purchase_line_balances
        WHERE order_id = ? ORDER BY id`).bind(id)
    ]);
    if (!header.results[0]) fail('Purchase order not found.', 404);
    return { record: { ...header.results[0], lines: lines.results } };
  }
  const { after, search } = queryPage(url);
  const result = await db.prepare(`SELECT ${ORDER_FIELDS},
    (SELECT count(*) FROM purchase_order_lines WHERE order_id = purchase_orders.id) AS line_count,
    (SELECT sum(quantity) FROM purchase_order_lines WHERE order_id = purchase_orders.id) AS unit_count
    FROM purchase_orders WHERE (? IS NULL OR id < ?)
    AND instr(lower(code || ' ' || supplier_name || ' ' || notes), lower(?)) > 0
    ORDER BY id DESC LIMIT ?`).bind(after, after, search, PAGE_SIZE + 1).all();
  return pageRows(result.results);
}

async function writeOrder(db, id, body, userId) {
  const notes = text(body.notes ?? '', 'Remarks', 1000);
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > MAX_LINES)
    fail(`Add between 1 and ${MAX_LINES} order lines.`);
  const lines = body.lines.map(line => ({
    variantId: integer(line?.variantId, 'Item size'),
    quantity: integer(line?.quantity, 'Quantity', MAX_QUANTITY)
  }));
  if (new Set(lines.map(line => line.variantId)).size !== lines.length)
    fail('Combine repeated item sizes into one order line.');

  const payload = JSON.stringify(lines);
  const token = crypto.randomUUID();
  const supplierId = id ? null : integer(body.supplierId, 'Supplier');
  let creationKey;
  let fingerprint;
  if (!id) {
    const requestId = body.requestId ?? token;
    if (typeof requestId !== 'string' || !/^[a-z0-9-]{16,64}$/i.test(requestId))
      fail('Invalid order request ID.');
    creationKey = `${userId}:${requestId}`;
    const canonical = JSON.stringify([supplierId, notes, [...lines].sort((left, right) => left.variantId - right.variantId)]);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  const header = id
    ? db.prepare(`UPDATE purchase_orders SET notes = ?, updated_at = unixepoch(), version = version + 1, write_token = ?
        WHERE id = ? AND status = 'pending' AND version = ? AND ${ORDER_UNPOSTED} RETURNING id, code`)
        .bind(notes, token, id, integer(body.version, 'Order version'))
    : db.prepare(`INSERT INTO purchase_orders (supplier_id, supplier_name, notes, created_by, creation_key, write_token)
        SELECT id, name, ?, ?, ?, ? FROM suppliers WHERE id = ? AND status = 'active'
        ON CONFLICT(creation_key) DO NOTHING RETURNING id, code`)
        .bind(notes, userId, creationKey, token, supplierId);
  // The header's unique write token scopes changes to this batch. A stale edit
  // affects zero rows. An invalid selected variant yields NULL and rolls the
  // entire batch back. Retained lines keep their IDs and original print labels.
  const upsertLines = db.prepare(`INSERT INTO purchase_order_lines (order_id, variant_id, item_name, size, quantity)
    SELECT o.id, CASE WHEN (s.status = 'active' AND i.status = 'active' AND v.status = 'active')
        OR old.quantity >= json_extract(line.value, '$.quantity') THEN v.id END,
      i.name, v.size, json_extract(line.value, '$.quantity')
    FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
    CROSS JOIN json_each(?) line
    LEFT JOIN catalog_variants v ON v.id = json_extract(line.value, '$.variantId')
    LEFT JOIN catalog_items i ON i.id = v.item_id AND i.supplier_id = o.supplier_id
    LEFT JOIN purchase_order_lines old ON old.order_id = o.id AND old.variant_id = v.id
    WHERE o.write_token = ?
    ON CONFLICT(order_id, variant_id) DO UPDATE SET quantity = excluded.quantity`).bind(payload, token);
  const removeLines = db.prepare(`DELETE FROM purchase_order_lines
    WHERE order_id = (SELECT id FROM purchase_orders WHERE write_token = ?)
    AND variant_id NOT IN (SELECT json_extract(value, '$.variantId') FROM json_each(?))`).bind(token, payload);
  try {
    // Fingerprint the original create in its own transaction so later edits
    // never change which request is eligible for an idempotent replay.
    const [result] = await db.batch([header, upsertLines, id ? removeLines : db.prepare(`
      INSERT INTO purchase_order_requests (order_id, fingerprint)
      SELECT id, ? FROM purchase_orders WHERE write_token = ?`).bind(fingerprint, token)]);
    const order = result.results[0];
    if (!order) {
      if (!id) {
        // A repeat of a committed create returns its original reference even
        // if the supplier was later retired. The key is scoped to this user.
        const previous = await db.prepare(`SELECT o.id, o.code, r.fingerprint FROM purchase_orders o
          LEFT JOIN purchase_order_requests r ON r.order_id = o.id WHERE o.creation_key = ?`).bind(creationKey).first();
        if (!previous) fail('Choose an active supplier.', 409);
        if (previous.fingerprint !== fingerprint)
          fail(`This request already created ${previous.code}. Check the saved order before submitting another.`, 409);
        return { id: previous.id, code: previous.code };
      }
      if (!await db.prepare('SELECT id FROM purchase_orders WHERE id = ?').bind(id).first())
        fail('Purchase order not found.', 404);
      fail('The order changed or is no longer pending. Reload it before editing.', 409);
    }
    return order;
  } catch (error) {
    if (/NOT NULL constraint failed: purchase_order_lines\./i.test(constraintError(error)))
      fail('Choose active item sizes from the selected supplier. Inactive lines can only be kept or reduced.', 409);
    throw error;
  }
}

export function readManagement(db, route, url, user) {
  if (route.resource === 'purchase-orders') return readOrders(db, route.detail, url);
  const id = route.detail ? integer(Number(route.detail), 'Record ID') : null;
  return readRegister(db, REGISTERS[route.resource], id, url,
    user.role !== 'admin' || url.searchParams.get('active') === '1');
}

export function writeManagement(db, route, body, user) {
  const id = route.detail ? integer(Number(route.detail), 'Record ID') : null;
  if (route.resource === 'purchase-orders') return writeOrder(db, id, body, user.id);
  return writeRegister(db, route.resource, id, body);
}
