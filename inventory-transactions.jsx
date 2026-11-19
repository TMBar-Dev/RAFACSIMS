import React, { useState } from 'react';
import { Button, Card, TextField, Typography } from '@mui/material';
import { RecordPicker, useResource } from './management-ui.jsx';
import {
  CorrectionForm, DataTable, formatDate, InventoryHeading, InventoryLink, InventoryList,
  inventoryHref, PendingPosting, PrintRecord, queryId, usePosting
} from './inventory-ui.jsx';

const workflows = {
  receipts: { title: 'Receiving', name: 'Receipt', party: 'Supplier' },
  issues: { title: 'Issue Uniform', name: 'Uniform issue', party: 'Cadet' },
  'supplier-returns': { title: 'Supplier Returns', name: 'Supplier return', party: 'Supplier' }
};

const lineColumns = [['Item', 'item_name'], ['Size', 'size'], ['Quantity', 'quantity']];

function cadetLabel(cadet) {
  return [`${cadet.first_name} ${cadet.last_name}`, cadet.service_number || `Cadet #${cadet.id}`, cadet.flight]
    .filter(Boolean).join(' · ');
}

function RemarksField({ notes, setNotes }) {
  return <TextField className="order-remarks" label="Remarks" fullWidth multiline size="small" variant="outlined"
    value={notes} onChange={event => setNotes(event.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />;
}

function ReceiptForm({ posting, order, backOrderId, onSave }) {
  const remaining = order.lines.filter(line => line.remaining > 0);
  const [quantities, setQuantities] = useState({});
  const [notes, setNotes] = useState('');
  const { saving, error, post } = posting;
  const canReceive = remaining.length > 0 && order.status !== 'cancelled' &&
    (!backOrderId || backOrderId === order.back_order_id);
  if (!canReceive) return <p className="message-banner" role="status">This order has no units available to receive.</p>;
  const columns = [
    ['Item', 'item_name'], ['Size', 'size'], ['Ordered', 'quantity'],
    ['Previously received', 'received'], ['Remaining', 'remaining'],
    ['Receive now', line => <TextField type="number" variant="outlined" size="small"
      value={quantities[line.id] ?? 0}
      slotProps={{ htmlInput: { min: 0, max: line.remaining, step: 1, 'aria-label': `Receive ${line.item_name}, size ${line.size}` } }}
      onChange={event => {
        const quantity = event.target.value;
        setQuantities(values => ({ ...values, [line.id]: quantity }));
      }} />]
  ];
  return (
    <Card className="workspace-card screen-only" variant="outlined">
      <div className="section-heading">
        <Typography component="h2" variant="h6">Receive {order.code}</Typography>
        <InventoryLink page="orders" query={{ id: order.id }}>View purchase order</InventoryLink>
      </div>
      <p>{order.supplier_name}</p>
      <form aria-busy={saving} onSubmit={event => {
        event.preventDefault();
        post('receipts', { orderId: order.id, backOrderId, notes, lines: remaining.map(line => ({
          orderLineId: line.id, quantity: Number(quantities[line.id] ?? 0)
        })) }, onSave);
      }}>
        <fieldset disabled={saving} className="record-fieldset">
          <DataTable label="Quantities to receive" rows={remaining} columns={columns} />
          <Button type="button" onClick={() => setQuantities(Object.fromEntries(remaining.map(line => [line.id, line.remaining])))}>
            Receive all remaining
          </Button>
          <RemarksField notes={notes} setNotes={setNotes} />
          <div className="record-tools">
            <Button type="submit" color="primary" variant="contained"
              disabled={!Object.values(quantities).some(quantity => Number(quantity) > 0)}>
              {saving ? 'Posting…' : 'Post receipt'}
            </Button>
            <Button type="button" disabled={saving}
              onClick={() => { window.location.hash = inventoryHref('receipts', { orderHistory: order.id }); }}>Cancel</Button>
          </div>
        </fieldset>
        {error && <p className="error-message" role="alert">{error}</p>}
      </form>
    </Card>
  );
}

function OutboundForm({ request, page, posting, onSave }) {
  const issue = page === 'issues';
  const config = workflows[page];
  const [party, setParty] = useState(null);
  const [variant, setVariant] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [lines, setLines] = useState([]);
  const [notes, setNotes] = useState('');
  const [lineError, setLineError] = useState('');
  const { saving, error, post } = posting;

  function addLine() {
    const units = Number(quantity);
    const alreadyAdded = lines.find(line => line.id === variant.id)?.quantity ?? 0;
    if (!Number.isInteger(units) || units < 1 || alreadyAdded + units > Math.min(variant.available, 1000000)) {
      setLineError('Enter a positive whole quantity within the available balance for this size.');
      return;
    }
    setLineError('');
    setLines(current => alreadyAdded
      ? current.map(line => line.id === variant.id ? { ...line, quantity: line.quantity + units } : line)
      : [...current, { ...variant, quantity: units }]);
    setVariant(null);
    setQuantity('1');
  }
  const columns = [...lineColumns, ...(issue ? [['Supplier', 'supplier_name']] : []), ['Action', line => <Button type="button"
    aria-label={`Remove ${line.item_name}, size ${line.size}, from ${line.supplier_name}`}
    onClick={() => setLines(current => current.filter(value => value.id !== line.id))}>Remove</Button>]];
  return (
    <Card className="workspace-card screen-only" variant="outlined">
      <Typography component="h2" variant="h6">New {config.name.toLowerCase()}</Typography>
      <form aria-busy={saving} onSubmit={event => {
        event.preventDefault();
        if (!party || !lines.length || variant) return;
        post(page, {
          [issue ? 'cadetId' : 'supplierId']: party.id, notes,
          lines: lines.map(line => ({ variantId: line.id, quantity: line.quantity }))
        }, onSave);
      }}>
        <fieldset disabled={saving} className="record-fieldset">
          {lines.length ? <p><strong>{config.party}</strong> {issue ? cadetLabel(party) : party.name}</p>
            : <RecordPicker request={request} label={config.party} endpoint={issue ? 'cadets?active=1' : 'suppliers?active=1'}
                value={party} onChange={value => { setParty(value); setVariant(null); setLineError(''); }}
                format={record => issue ? cadetLabel(record) : record.name} />}
          {party && <div className="order-line-picker">
            <RecordPicker request={request} key={party.id} label="Item size" value={variant} onChange={setVariant}
              endpoint={`variants?active=1&inStock=1${issue ? '' : `&supplierId=${party.id}`}`}
              format={record => [record.item_name, record.size, issue && record.supplier_name, `${record.available} available`]
                .filter(Boolean).join(' · ')} />
            <div className="record-tools">
              <TextField disabled={!variant} label="New line quantity" type="number" value={quantity}
                size="small" variant="outlined" slotProps={{ htmlInput: { min: 1, step: 1 } }}
                onChange={event => setQuantity(event.target.value)} />
              <Button type="button" variant="outlined" disabled={!variant || (lines.length >= 50 && !lines.some(line => line.id === variant?.id))}
                onClick={addLine}>Add line</Button>
            </div>
          </div>}
          {lineError && <p className="error-message" role="alert">{lineError}</p>}
          {lines.length > 0 && <DataTable label="Selected item sizes" rows={lines} columns={columns} />}
          <RemarksField notes={notes} setNotes={setNotes} />
          <div className="record-tools">
            <Button type="submit" color="primary" variant="contained" disabled={!party || !lines.length || Boolean(variant)}>
              {saving ? 'Posting…' : `Post ${config.name.toLowerCase()}`}
            </Button>
            <Button type="button" disabled={saving} onClick={() => { window.location.hash = inventoryHref(page); }}>Cancel</Button>
          </div>
        </fieldset>
        {error && <p className="error-message" role="alert">{error}</p>}
      </form>
    </Card>
  );
}

export default function TransactionsPage({ request, page, query, canCorrect, postingOwner }) {
  const config = workflows[page];
  const id = queryId(query, 'id');
  const orderId = queryId(query, 'order');
  const historyOrder = orderId ?? queryId(query, 'orderHistory');
  const cadetId = queryId(query, 'cadetId');
  const [revision, setRevision] = useState(0);
  const [correcting, setCorrecting] = useState(false);
  const posting = usePosting(request, { owner: postingOwner, workflow: page });
  const detail = useResource(request, id ? `${page}/${id}` : null, revision);
  const order = useResource(request, orderId && page === 'receipts' ? `purchase-orders/${orderId}` : null, revision);
  const record = detail?.data?.record;
  const endpoint = historyOrder && page === 'receipts' ? `receipts?orderId=${historyOrder}`
    : cadetId && page === 'issues' ? `issues?cadetId=${cadetId}` : page;
  const columns = [
    ['Reference', 'code'], [config.party, 'party_name'], ['Date', row => formatDate(row.created_at)],
    ['Lines', 'line_count'], ['Units', 'unit_count'], ['Status', row => row.reversal_code ? 'Reversed' : 'Posted'],
    ['Details', row => <InventoryLink page={page} query={{ id: row.id }}>View {row.code}</InventoryLink>]
  ];
  function saved({ id }) { window.location.hash = inventoryHref(page, { id }); }
  return (
    <>
      <InventoryHeading title={config.title}>
        {page === 'receipts' ? <InventoryLink page="orders">Open orders</InventoryLink>
          : <InventoryLink page={page} query={{ create: 1 }}>New {config.name.toLowerCase()}</InventoryLink>}
      </InventoryHeading>
      <PendingPosting posting={posting} onSave={saved} />
      {orderId && page === 'receipts' && (order?.data ? <ReceiptForm posting={posting}
        order={order.data.record} backOrderId={queryId(query, 'backOrder')} onSave={saved} />
        : <p role={order?.error ? 'alert' : 'status'}>{order?.error ?? 'Loading order lines…'}</p>)}
      {page !== 'receipts' && query.get('create') === '1' && <OutboundForm request={request}
        page={page} posting={posting} onSave={saved} />}
      {id && !record && <p role={detail?.error ? 'alert' : 'status'}>{detail?.error ?? 'Loading details…'}</p>}
      {record && (
        <>
          <PrintRecord title={`${config.name} ${record.code}`} actions={<>
            {canCorrect && !record.reversal_code && <Button type="button" color="secondary" onClick={() => setCorrecting(true)}>
              Reverse
            </Button>}
            <InventoryLink page={page}>Close details</InventoryLink>
          </>}>
            <dl className="account-details">
              <div><dt>{config.party}</dt><dd>{record.party_name}</dd></div>
              <div><dt>Posted by</dt><dd>{record.actor_name}</dd></div>
              <div><dt>Date</dt><dd>{formatDate(record.created_at)}</dd></div>
              {record.order_code && <div><dt>Purchase order</dt><dd>{record.order_code}</dd></div>}
              {record.back_order_code && <div><dt>Back order</dt><dd>{record.back_order_code}</dd></div>}
            </dl>
            <DataTable label="Transaction lines" columns={lineColumns} rows={record.lines} />
            {record.notes && <div className="order-notes"><h3>Remarks</h3><p>{record.notes}</p></div>}
            {record.reversal_code && <div className="order-notes">
              <h3>Reversed by {record.reversed_by} · {record.reversal_code}</h3>
              <p>{formatDate(record.reversed_at)} · {record.reversal_reason}</p>
            </div>}
          </PrintRecord>
          {correcting && canCorrect && !record.reversal_code && <CorrectionForm request={request}
            endpoint={`${page}/${id}/reverse`} label="Reverse transaction" onClose={() => setCorrecting(false)}
            onSave={() => { setCorrecting(false); setRevision(value => value + 1); }} />}
        </>
      )}
      <InventoryList key={`${endpoint}:${revision}`} request={request} endpoint={endpoint}
        title={`${config.name} history`} columns={columns} />
    </>
  );
}
