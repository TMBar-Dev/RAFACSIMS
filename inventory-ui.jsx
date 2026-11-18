import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, TextField, Typography } from '@material-ui/core';
import { RecordPager, RecordSearch, useRecords } from './management-ui.jsx';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London'
});
export const formatDate = seconds => dateFormat.format(seconds * 1000);

export function inventoryHref(page, query = {}) {
  const search = new URLSearchParams(query).toString();
  return `#/${page}${search ? `?${search}` : ''}`;
}

export function queryId(query, key) {
  const value = Number(query.get(key));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function InventoryLink({ page, query, children }) {
  return <Button component="a" href={inventoryHref(page, query)} color="primary">{children}</Button>;
}

export function InventoryHeading({ title, children }) {
  return (
    <header className="page-heading section-heading screen-only">
      <Typography variant="h4" component="h1">{title}</Typography>
      {children}
    </header>
  );
}

export function DataTable({ label, columns, rows }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="records-table">
        <thead><tr>{columns.map(([heading]) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
        <tbody>
          {rows.map(row => <tr key={row.id}>{columns.map(([heading, field]) => (
            <td key={heading}>{typeof field === 'function' ? field(row) : row[field]}</td>
          ))}</tr>)}
          {!rows.length && <tr><td colSpan={columns.length}>No matching records.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryList({ request, endpoint, title, columns }) {
  const [revision, setRevision] = useState(0);
  const list = useRecords(request, endpoint, revision);
  return (
    <Card className="workspace-card screen-only" variant="outlined" aria-busy={!list.result}>
      <div className="section-heading">
        <Typography component="h2" variant="h6">{title}</Typography>
        <Button type="button" onClick={() => setRevision(value => value + 1)}>Refresh</Button>
      </div>
      <RecordSearch label={`Search ${title.toLowerCase()}`} onSearch={list.search} />
      {!list.result ? <p role="status">Loading records…</p>
        : list.result.error ? <p className="error-message" role="alert">{list.result.error}</p>
          : <DataTable label={title} columns={columns} rows={list.result.data.records} />}
      <RecordPager list={list} />
    </Card>
  );
}

export function PrintRecord({ title, children, actions }) {
  return (
    <Card className="workspace-card purchase-print" variant="outlined">
      <div className="section-heading">
        <Typography component="h2" variant="h5">{title}</Typography>
        <div className="template-actions screen-only">
          {actions}
          <Button type="button" variant="outlined" onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      {children}
    </Card>
  );
}

export function usePosting(request) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const pending = useRef(false);
  const [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function post(path, body, onSave) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const saved = await request(path, { ...body, requestId });
      if (mounted.current) onSave(saved);
    } catch (error) {
      if (mounted.current) setError(error.message);
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return { saving, error, post };
}

export function CorrectionForm({ request, endpoint, label, onSave, onClose }) {
  const [reason, setReason] = useState('');
  const { saving, error, post } = usePosting(request);
  return (
    <Card className="workspace-card screen-only" variant="outlined">
      <Typography component="h2" variant="h6">{label}</Typography>
      <form onSubmit={event => { event.preventDefault(); post(endpoint, { reason }, onSave); }}>
        <fieldset disabled={saving} className="record-fieldset">
          <TextField className="order-remarks" fullWidth required label="Reason" variant="outlined" value={reason}
            onChange={event => setReason(event.target.value)} inputProps={{ maxLength: 1000 }} />
          <div className="record-tools">
            <Button type="submit" variant="contained" color="secondary" disabled={!reason.trim()}>
              {saving ? 'Saving…' : `Confirm ${label.toLowerCase()}`}
            </Button>
            <Button type="button" onClick={onClose}>Back</Button>
          </div>
        </fieldset>
        {error && <p className="error-message" role="alert">{error}</p>}
      </form>
    </Card>
  );
}
