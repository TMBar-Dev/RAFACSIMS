import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, TextField, Typography } from '@mui/material';
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

// Keep only the request ID in this tab. The API scopes recovery to the
// signed-in account, and form fields never need to be written to storage.
function readPending(key) {
  if (!key) return null;
  try {
    const value = sessionStorage.getItem(key);
    return /^[a-f0-9-]{36}$/.test(value ?? '') ? value : null;
  } catch {
    return null;
  }
}

function clearPending(key, id) {
  if (readPending(key) !== id) return;
  try { sessionStorage.removeItem(key); } catch { /* The same ID remains safe to recover. */ }
}

export function usePosting(request, { owner, workflow } = {}) {
  const storageKey = owner && workflow ? `rafacsims.pending.${owner}.${workflow}` : null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState(() => readPending(storageKey));
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function perform(action) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError('');
    setRecoveryMessage('');
    try {
      await action();
    } catch (error) {
      if (mounted.current) setError(error.message);
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function confirm(id, saved, onSave) {
    // If the user left the page during the request, keep the ID even when the
    // response succeeds. They still need to see which record was saved.
    if (!mounted.current) return;
    if (id) {
      clearPending(storageKey, id);
      setPendingId(null);
    }
    onSave(saved);
  }

  function post(path, body, onSave) {
    return perform(async () => {
      const tracked = path === workflow && Boolean(storageKey);
      const previous = tracked ? readPending(storageKey) ?? pendingId : null;
      const id = previous ?? crypto.randomUUID();
      if (tracked) {
        try { sessionStorage.setItem(storageKey, id); }
        catch { throw new Error('Allow session storage in this tab before posting so interrupted saves can be recovered.'); }
        setPendingId(id);
      }
      let result;
      try {
        result = await request(path, { ...body, requestId: id });
      } catch (error) {
        // An explicit application rejection can release a new request ID.
        // A prior attempt may already have committed, regardless of how this
        // retry failed. Keep that ID until the outcome is confirmed.
        if (tracked && !previous && mounted.current && [400, 401, 403, 404, 405, 409, 413, 415, 429].includes(error.status)) {
          clearPending(storageKey, id);
          setPendingId(null);
        }
        throw error;
      }
      confirm(tracked ? id : null, result, onSave);
    });
  }

  function recover(onSave) {
    return perform(async () => {
      const id = readPending(storageKey) ?? pendingId;
      if (!id) return;
      try {
        const saved = await request(`posting-status/${workflow}/${id}`);
        confirm(id, saved, onSave);
      } catch (error) {
        if (!mounted.current) return;
        setRecoveryMessage(error.status === 404
          ? 'No saved record was found yet. Re-enter the transaction to retry using the same request ID.'
          : error.message);
      }
    });
  }

  return { saving, error, post, pendingId, recoveryMessage, recover };
}

export function PendingPosting({ posting, onSave }) {
  if (!posting.pendingId) return null;
  return (
    <div className="message-banner screen-only">
      <p>A previous save is awaiting confirmation in this tab.</p>
      <Button type="button" variant="outlined" disabled={posting.saving}
        onClick={() => posting.recover(onSave)}>Check previous save</Button>
      {posting.recoveryMessage && <p role="status">{posting.recoveryMessage}</p>}
    </div>
  );
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
            onChange={event => setReason(event.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
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
