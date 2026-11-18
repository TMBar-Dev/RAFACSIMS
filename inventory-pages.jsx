import React, { useState } from 'react';
import { Button, Card, TextField, Typography } from '@material-ui/core';
import { RecordPicker, useResource } from './management-ui.jsx';
import {
  DataTable, formatDate, InventoryHeading, InventoryLink, InventoryList, inventoryHref, PrintRecord, queryId, usePosting
} from './inventory-ui.jsx';

const details = (result, label) => !result ? <p role="status">Loading {label}…</p>
  : <p className="error-message" role="alert">{result.error}</p>;

export function BackOrderSummary({ request }) {
  const result = useResource(request, 'back-orders/summary');
  return (
    <Card className="workspace-card summary-card" variant="outlined" aria-busy={!result}>
      <Typography component="h2" variant="h6">Pending back orders</Typography>
      {result?.data ? <strong className="summary-value">{result.data.pending}</strong> : details(result, 'back-order count')}
      <InventoryLink page="back-orders">Open back orders</InventoryLink>
    </Card>
  );
}

export function BackOrders({ request, query }) {
  const id = queryId(query, 'id');
  const result = useResource(request, id ? `back-orders/${id}` : null);
  const record = result?.data?.record;
  return (
    <>
      <InventoryHeading title="Back Orders" />
      {id && (record ? (
        <PrintRecord title={`Back order ${record.code}`} actions={<>
          {record.status === 'open' && <InventoryLink page="receipts"
            query={{ order: record.order_id, backOrder: record.id }}>Receive</InventoryLink>}
          <InventoryLink page="orders" query={{ id: record.order_id }}>Purchase order</InventoryLink>
          <InventoryLink page="receipts" query={{ orderHistory: record.order_id }}>Receipt history</InventoryLink>
          <InventoryLink page="back-orders">Close details</InventoryLink>
        </>}>
          <dl className="account-details">
            <div><dt>Purchase order</dt><dd>{record.order_code}</dd></div>
            <div><dt>Supplier</dt><dd>{record.supplier_name}</dd></div>
            <div><dt>Created</dt><dd>{formatDate(record.created_at)}</dd></div>
            <div><dt>Status</dt><dd>{record.status === 'open' ? 'Open' : 'Closed'}</dd></div>
          </dl>
          <DataTable label="Back-order lines" rows={record.lines} columns={[
            ['Item', 'item_name'], ['Size', 'size'], ['Ordered', 'quantity'], ['Received', 'received'], ['Remaining', 'remaining']
          ]} />
        </PrintRecord>
      ) : details(result, 'back order'))}
      <InventoryList request={request} endpoint="back-orders" title="Back orders" columns={[
        ['Reference', 'code'], ['Purchase order', 'order_code'], ['Supplier', 'supplier_name'],
        ['Open lines', 'line_count'], ['Units remaining', 'unit_count'],
        ['Status', row => row.status === 'open' ? 'Open' : 'Closed'],
        ['Details', row => <InventoryLink page="back-orders" query={{ id: row.id }}>View {row.code}</InventoryLink>]
      ]} />
    </>
  );
}

function OpeningBalance({ request }) {
  const [legacy, setLegacy] = useState(null);
  const [variant, setVariant] = useState(null);
  const [notes, setNotes] = useState('');
  const { saving, error, post } = usePosting(request);
  return (
    <Card className="workspace-card" variant="outlined">
      <Typography component="h2" variant="h6">Map legacy stock</Typography>
      <p>Match a legacy stock record to its catalog size to carry its recorded quantity into the stock ledger once.</p>
      <form aria-busy={saving} onSubmit={event => {
        event.preventDefault();
        if (!legacy || !variant) return;
        post('opening-balances', { legacyId: legacy.id, variantId: variant.id, notes }, () => {
          window.location.hash = inventoryHref('stock', { id: variant.item_id });
        });
      }}>
        <fieldset disabled={saving} className="record-fieldset">
          <RecordPicker request={request} endpoint="opening-balances" label="Legacy stock record" value={legacy}
            onChange={setLegacy} format={row => [row.reference, row.description, row.size, `${row.quantity} units`].filter(Boolean).join(' · ')} />
          <RecordPicker request={request} endpoint="variants?active=1" label="Catalog size" value={variant}
            onChange={setVariant} format={row => `${row.item_name} · ${row.size}`} />
          <TextField className="order-remarks" label="Mapping note" required fullWidth variant="outlined" value={notes}
            onChange={event => setNotes(event.target.value)} inputProps={{ maxLength: 1000 }} />
          <div className="record-tools">
            <Button type="submit" color="primary" variant="contained" disabled={!legacy || !variant || !notes.trim()}>
              {saving ? 'Posting…' : 'Post opening balance'}
            </Button>
            <Button type="button" disabled={saving} onClick={() => { window.location.hash = inventoryHref('stock'); }}>Cancel</Button>
          </div>
        </fieldset>
        {error && <p className="error-message" role="alert">{error}</p>}
      </form>
    </Card>
  );
}

const movementKinds = {
  receipt: ['Receipt', 'receipts'], issue: ['Issue', 'issues'], return: ['Supplier return', 'supplier-returns'],
  opening: ['Opening balance'], reversal: ['Reversal']
};

export function StockPage({ request, query, canCorrect }) {
  const id = queryId(query, 'id');
  const result = useResource(request, id ? `inventory-stock/${id}` : null);
  const record = result?.data?.record;
  return (
    <>
      <InventoryHeading title="Stock Management">
        {canCorrect && <InventoryLink page="stock" query={{ opening: 1 }}>Map legacy stock</InventoryLink>}
      </InventoryHeading>
      {canCorrect && query.get('opening') === '1' && <OpeningBalance request={request} />}
      {id && (record ? <>
        <Card className="workspace-card" variant="outlined">
          <div className="section-heading">
            <Typography component="h2" variant="h6">{record.name}</Typography>
            <InventoryLink page="stock">Close details</InventoryLink>
          </div>
          <p>{record.supplier_name} · {record.quantity} available across all sizes</p>
          {record.description && <p>{record.description}</p>}
        </Card>
        <InventoryList request={request} endpoint={`inventory-stock/${id}/sizes`} title="Sizes" columns={[
          ['Size', 'size'], ['Available units', 'quantity'], ['Status', row => row.status === 'active' ? 'Active' : 'Inactive']
        ]} />
        <InventoryList request={request} endpoint={`inventory-stock/${id}/movements`} title="Stock movements" columns={[
          ['Reference', row => movementKinds[row.kind][1]
            ? <InventoryLink page={movementKinds[row.kind][1]} query={{ id: row.transaction_id }}>{row.code}</InventoryLink>
            : row.code],
          ['Type', row => movementKinds[row.kind][0]], ['Original reference', row => row.original_code ?? '—'],
          ['Size', 'size'], ['Unit change', row => row.quantity_delta > 0 ? `+${row.quantity_delta}` : row.quantity_delta],
          ['Actor', 'actor_name'], ['Posted', row => formatDate(row.created_at)], ['Remarks', row => row.notes || '—']
        ]} />
      </> : details(result, 'stock details'))}
      <InventoryList request={request} endpoint="inventory-stock" title="Stock items" columns={[
        ['Item', 'name'], ['Supplier', 'supplier_name'], ['Description', 'description'],
        ['Available units', 'quantity'], ['Details', row => <InventoryLink page="stock" query={{ id: row.id }}>View {row.name}</InventoryLink>]
      ]} />
    </>
  );
}

export function CadetKit({ request, query }) {
  const id = queryId(query, 'id');
  const result = useResource(request, id ? `cadet-kit/${id}` : null);
  const record = result?.data?.record;
  return (
    <>
      <InventoryHeading title="Cadet Kit" />
      {id && (record ? <>
        <Card className="workspace-card" variant="outlined">
          <div className="section-heading">
            <Typography component="h2" variant="h6">{record.name}</Typography>
            <InventoryLink page="cadet-kit">Close details</InventoryLink>
          </div>
          <dl className="account-details">
            <div><dt>Issues</dt><dd>{record.issue_count}</dd></div>
            <div><dt>Lines issued</dt><dd>{record.line_count}</dd></div>
            <div><dt>Units issued</dt><dd>{record.unit_count}</dd></div>
          </dl>
        </Card>
        <InventoryList request={request} endpoint={`issues?cadetId=${id}`} title="Cadet issue history" columns={[
          ['Reference', 'code'], ['Recorded name', 'party_name'], ['Date', row => formatDate(row.created_at)],
          ['Lines', 'line_count'], ['Units', 'unit_count'], ['Status', row => row.reversal_code ? 'Reversed' : 'Posted'],
          ['Details', row => <InventoryLink page="issues" query={{ id: row.id }}>View {row.code}</InventoryLink>]
        ]} />
      </> : details(result, 'cadet kit history'))}
      <InventoryList request={request} endpoint="cadet-kit" title="Cadets with issue history" columns={[
        ['Cadet', 'name'], ['Issues', 'issue_count'], ['Lines issued', 'line_count'], ['Units issued', 'unit_count'],
        ['Details', row => <InventoryLink page="cadet-kit" query={{ id: row.id }}>View {row.name}</InventoryLink>]
      ]} />
    </>
  );
}
