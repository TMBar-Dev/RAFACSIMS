import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, TextField, Typography } from '@material-ui/core';
import { RecordPager, RecordPicker, RecordSearch, useRecords, useResource } from './management-ui.jsx';

const ENDPOINT = 'purchase-orders';
const MAX_LINES = 50;
const MAX_QUANTITY = 1_000_000;
const statuses = { pending: 'Pending', partial: 'Partially received', received: 'Received' };
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London'
});

function OrderEditor({ request, record, onSave, onCancel }) {
  const [supplier, setSupplier] = useState(record ? { id: record.supplier_id, name: record.supplier_name } : null);
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [lines, setLines] = useState(record?.lines ?? []);
  const [variant, setVariant] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function addLine() {
    setError('');
    const units = Number(quantity);
    if (!Number.isInteger(units) || units < 1 || units > MAX_QUANTITY) {
      setError('Enter a whole quantity between 1 and 1,000,000.');
      return;
    }
    if (lines.some(line => line.variant_id === variant.id)) {
      setError('That item size is already on this order. Edit its quantity in the table.');
      return;
    }
    setLines(lines => [...lines, { variant_id: variant.id, item_name: variant.item_name, size: variant.size, quantity: units }]);
    setVariant(null);
    setQuantity('1');
  }

  async function save(event) {
    event.preventDefault();
    if (saving || !supplier || !lines.length) return;
    if (variant) {
      setError('Add the selected item size to the order or clear the selection before saving.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        ...(record ? { version: record.version } : { supplierId: supplier.id, requestId }),
        notes,
        lines: lines.map(line => ({ variantId: line.variant_id, quantity: Number(line.quantity) }))
      };
      const saved = await request(record ? `${ENDPOINT}/${record.id}` : ENDPOINT, body);
      if (mounted.current) onSave(saved);
    } catch (error) {
      if (mounted.current) setError(error.message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <Card className="workspace-card" variant="outlined">
      <Typography variant="h6" component="h2">{record ? `Edit ${record.code}` : 'Create purchase order'}</Typography>
      <form onSubmit={save} aria-busy={saving}>
        <fieldset className="record-fieldset" disabled={saving}>
          {record || lines.length ? <p>Supplier: {supplier.name}</p> : (
            <RecordPicker request={request} endpoint="suppliers?active=1" label="Supplier" value={supplier}
              format={option => option.name} onChange={option => { setSupplier(option); setVariant(null); }} />
          )}
          {supplier && lines.length < MAX_LINES && (
            <div className="order-line-picker">
              <RecordPicker key={supplier.id} request={request}
                endpoint={`variants?active=1&supplierId=${supplier.id}`} label="Item size" value={variant}
                format={option => `${option.item_name} · ${option.size}`} onChange={setVariant} />
              <div className="record-tools">
                <TextField label="New line quantity" type="number" value={quantity} size="small" variant="outlined" disabled={!variant}
                  onChange={event => setQuantity(event.target.value)}
                  inputProps={{ min: 1, max: MAX_QUANTITY, step: 1 }} />
                <Button type="button" color="primary" variant="outlined" disabled={!variant} onClick={addLine}>Add line</Button>
              </div>
            </div>
          )}
          {lines.length > 0 && <OrderLines lines={lines} onChange={setLines} />}
          <TextField className="order-remarks" label="Remarks" fullWidth multiline size="small" variant="outlined"
            value={notes} inputProps={{ maxLength: 1000 }} onChange={event => setNotes(event.target.value)} />
          <div className="record-tools">
            <Button type="submit" color="primary" variant="contained" disabled={saving || !lines.length}>
              {saving ? 'Saving…' : 'Save order'}
            </Button>
            <Button type="button" onClick={onCancel} disabled={saving}>Cancel</Button>
          </div>
        </fieldset>
        {error && <p className="error-message" role="alert">{error}</p>}
      </form>
    </Card>
  );
}

function OrderLines({ lines, onChange }) {
  return (
    <div className="table-scroll" role="region" aria-label="Order lines" tabIndex={0}>
      <table className="records-table">
        <thead><tr><th scope="col">Item</th><th scope="col">Size</th><th scope="col">Quantity</th>
          {onChange && <th scope="col">Action</th>}</tr></thead>
        <tbody>{lines.map(line => (
          <tr key={line.variant_id}>
            <td>{line.item_name}</td><td>{line.size}</td>
            <td>{onChange ? <TextField required type="number" size="small" variant="outlined"
              value={line.quantity} inputProps={{ min: 1, max: MAX_QUANTITY, step: 1, 'aria-label': `Quantity for ${line.item_name}, size ${line.size}` }}
              onChange={event => {
                const quantity = event.target.value;
                onChange(lines => lines.map(value => value.variant_id === line.variant_id ? { ...value, quantity } : value));
              }} /> : line.quantity}</td>
            {onChange && <td><Button type="button" aria-label={`Remove ${line.item_name}, size ${line.size}`}
              onClick={() => onChange(lines => lines.filter(value => value.variant_id !== line.variant_id))}>Remove</Button></td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function OrderDetail({ record, onClose, onEdit }) {
  return (
    <Card className="workspace-card purchase-print" variant="outlined">
      <div className="section-heading">
        <Typography variant="h5" component="h2">Purchase order {record.code}</Typography>
        <div className="template-actions screen-only">
          {record.status === 'pending' && <Button type="button" variant="outlined" onClick={onEdit}>Edit</Button>}
          <Button type="button" variant="outlined" onClick={() => window.print()}>Print</Button>
          <Button type="button" onClick={onClose}>Close details</Button>
        </div>
      </div>
      <dl className="account-details">
        <div><dt>Supplier</dt><dd>{record.supplier_name}</dd></div>
        <div><dt>Created</dt><dd>{dateFormat.format(record.created_at * 1000)}</dd></div>
        <div><dt>Status</dt><dd>{statuses[record.status]}</dd></div>
        <div><dt>Lines</dt><dd>{record.lines.length}</dd></div>
        <div><dt>Units ordered</dt><dd>{record.lines.reduce((sum, line) => sum + line.quantity, 0)}</dd></div>
      </dl>
      <OrderLines lines={record.lines} />
      {record.notes && <div className="order-notes"><Typography variant="subtitle1" component="h3">Remarks</Typography>
        <p>{record.notes}</p></div>}
    </Card>
  );
}

export function PurchaseOrderSummary({ request }) {
  const result = useResource(request, `${ENDPOINT}/summary`);
  return (
    <Card className="workspace-card summary-card" variant="outlined" aria-busy={!result}>
      <Typography component="h2" variant="h6">Pending orders</Typography>
      {!result ? <p role="status">Loading order count…</p>
        : result.error ? <p className="error-message" role="alert">{result.error}</p>
        : <strong className="summary-value">{result.data.pending}</strong>}
      <Button component="a" href="#/orders" color="primary">Open orders</Button>
    </Card>
  );
}

export default function PurchaseOrders({ request }) {
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const list = useRecords(request, ENDPOINT, revision);
  const detail = useResource(request, selectedId ? `${ENDPOINT}/${selectedId}` : null, revision);
  const record = detail?.data?.record;
  const rows = list.result?.data?.records ?? [];

  function select(id, edit = false) {
    setSelectedId(id);
    setEditing(edit);
    setNotice('');
  }

  function saved({ id, code }) {
    select(id);
    setNotice(`${code} saved.`);
    setRevision(value => value + 1);
  }

  return (
    <>
      <header className="page-heading screen-only"><Typography component="h1" variant="h4">Orders</Typography></header>
      {notice && <p className="message-banner screen-only" role="status">{notice}</p>}
      {editing && (!selectedId || record) && <OrderEditor request={request} record={record}
        onSave={saved} onCancel={() => setEditing(false)} />}
      {selectedId && !editing && (record
        ? <OrderDetail record={record} onClose={() => select(null)} onEdit={() => setEditing(true)} />
        : <Card className="workspace-card" variant="outlined" aria-busy={!detail}>
          {!detail ? <p role="status">Loading order…</p> : <p className="error-message" role="alert">{detail.error}</p>}
          {detail?.error && <Button type="button" onClick={() => setRevision(value => value + 1)}>Retry</Button>}
          <Button type="button" onClick={() => select(null)}>Close details</Button>
        </Card>)}
      <Card className="workspace-card screen-only" variant="outlined" aria-busy={!list.result}>
        <div className="section-heading">
          <Typography component="h2" variant="h6">Purchase orders</Typography>
          <div className="template-actions">
            <Button type="button" onClick={() => setRevision(value => value + 1)} disabled={editing}>Refresh</Button>
            <Button type="button" variant="outlined" disabled={editing} onClick={() => select(null, true)}>Create order</Button>
          </div>
        </div>
        {!editing && <RecordSearch label="Search orders" onSearch={list.search} />}
        {!list.result ? <p role="status">Loading orders…</p>
          : list.result.error ? <p className="error-message" role="alert">{list.result.error}</p>
          : <div className="table-scroll" role="region" aria-label="Purchase orders" tabIndex={0}>
            <table className="records-table">
              <thead><tr>{['Reference', 'Created', 'Supplier', 'Lines', 'Units', 'Status', 'Details'].map(label =>
                <th key={label} scope="col">{label}</th>)}</tr></thead>
              <tbody>
                {rows.map(row => <tr key={row.id}>
                  <td>{row.code}</td><td>{dateFormat.format(row.created_at * 1000)}</td><td>{row.supplier_name}</td>
                  <td>{row.line_count}</td><td>{row.unit_count}</td><td>{statuses[row.status]}</td>
                  <td><Button type="button" aria-label={`View ${row.code}`} disabled={editing} onClick={() => select(row.id)}>View</Button></td>
                </tr>)}
                {!rows.length && <tr><td colSpan={7}>No matching orders.</td></tr>}
              </tbody>
            </table>
          </div>}
        {!editing && <RecordPager list={list} />}
      </Card>
    </>
  );
}
