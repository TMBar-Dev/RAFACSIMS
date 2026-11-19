import React, { useState } from 'react';
import { Button, Card, Typography } from '@mui/material';
import { useResource } from './management-ui.jsx';
import {
  CorrectionForm, DataTable, formatDate, InventoryHeading, InventoryLink, InventoryList, PrintRecord, queryId
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

function OpeningHistory({ request, balanceId }) {
  const [revision, setRevision] = useState(0);
  const [correcting, setCorrecting] = useState(false);
  const endpoint = balanceId ? 'opening-balances/' + balanceId : null;
  const result = useResource(request, endpoint, revision);
  const record = result?.data?.record;
  return (
    <>
      {balanceId && (record ? (
        <Card className="workspace-card" variant="outlined">
          <Typography component="h2" variant="h6">Opening balance {record.code}</Typography>
          <p>{record.party_name} ? {record.actor_name} ? {formatDate(record.created_at)}</p>
          {record.notes && <p>{record.notes}</p>}
          <DataTable label="Opening balance lines" rows={record.lines}
            columns={[["Item", 'item_name'], ["Size", 'size'], ["Quantity", 'quantity']]} />
          {record.reversal_code ? <p>Reversed by {record.reversed_by} ? {record.reversal_code} ? {record.reversal_reason}</p>
            : <Button type="button" color="secondary" onClick={() => setCorrecting(true)}>Reverse opening balance</Button>}
        </Card>
      ) : details(result, 'opening balance'))}
      {correcting && record && !record.reversal_code && <CorrectionForm request={request}
        endpoint={endpoint + '/reverse'} label="Reverse opening balance" onClose={() => setCorrecting(false)}
        onSave={() => { setCorrecting(false); setRevision(value => value + 1); }} />}
      <InventoryList key={revision} request={request} endpoint="opening-balances" title="Opening balance history" columns={[
        ['Reference', 'code'], ['Source stock', 'party_name'], ['Units', 'unit_count'],
        ['Status', row => row.reversal_code ? 'Reversed' : 'Posted'],
        ['Details', row => <InventoryLink page="stock" query={{ opening: 1, balanceId: row.id }}>View {row.code}</InventoryLink>]
      ]} />
    </>
  );
}

const movementKinds = {
  receipt: ['Receipt', 'receipts'], issue: ['Issue', 'issues'], return: ['Supplier return', 'supplier-returns'],
  opening: ['Opening balance'], reversal: ['Reversal']
};

export function StockPage({ request, query, canCorrect, canViewTransaction }) {
  const id = queryId(query, 'id');
  const result = useResource(request, id ? `inventory-stock/${id}` : null);
  const record = result?.data?.record;
  return (
    <>
      <InventoryHeading title="Stock Management">
        {canCorrect && <InventoryLink page="stock" query={{ opening: 1 }}>Opening balance history</InventoryLink>}
      </InventoryHeading>
      {canCorrect && query.get('opening') === '1' && <OpeningHistory request={request} balanceId={queryId(query, 'balanceId')} />}
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
          ['Reference', row => {
            const page = movementKinds[row.kind][1];
            return page && canViewTransaction(page)
              ? <InventoryLink page={page} query={{ id: row.transaction_id }}>{row.code}</InventoryLink>
              : row.code;
          }],
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
