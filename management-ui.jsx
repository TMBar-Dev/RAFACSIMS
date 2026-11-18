import React, { useEffect, useState } from 'react';
import { Button, TextField } from '@material-ui/core';

export function useResource(request, path, revision = 0) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!path) return;
    let active = true;
    request(path)
      .then(data => { if (active) setResult({ path, revision, data }); })
      .catch(error => { if (active) setResult({ path, revision, error: error.message }); });
    return () => { active = false; };
  }, [request, path, revision]);
  return result?.path === path && result?.revision === revision ? result : null;
}

export function useRecords(request, endpoint, revision = 0) {
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState([null]);
  const cursor = cursors.at(-1);
  const query = new URLSearchParams({ q: search });
  if (cursor !== null) query.set('after', cursor);
  const path = endpoint + (endpoint.includes('?') ? '&' : '?') + query;
  const result = useResource(request, path, revision);
  const next = result?.data?.nextCursor;
  return {
    result,
    search: value => { setSearch(value); setCursors([null]); },
    previous: cursors.length > 1 ? () => setCursors(cursors.slice(0, -1)) : undefined,
    next: next != null ? () => setCursors([...cursors, next]) : undefined
  };
}

export function RecordSearch({ label, onSearch }) {
  const [value, setValue] = useState('');
  return (
    <div className="record-tools">
      <TextField label={label} size="small" variant="outlined" value={value}
        inputProps={{ maxLength: 120 }} onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          onSearch(value.trim());
        }} />
      <Button type="button" variant="outlined" onClick={() => onSearch(value.trim())}>Search</Button>
      {value && <Button type="button" onClick={() => { setValue(''); onSearch(''); }}>Clear</Button>}
    </div>
  );
}

export function RecordPager({ list }) {
  if (!list.previous && !list.next) return null;
  return (
    <div className="pagination-controls">
      <Button type="button" onClick={list.previous} disabled={!list.previous}>Previous</Button>
      <Button type="button" onClick={list.next} disabled={!list.next}>Next</Button>
    </div>
  );
}

export function RecordPicker({ request, endpoint, label, value, onChange, format }) {
  const [revision, setRevision] = useState(0);
  const list = useRecords(request, endpoint, revision);
  const records = list.result?.data?.records ?? [];
  // Keep the selected option available while paging or changing the search.
  const options = value && !records.some(record => record.id === value.id) ? [value, ...records] : records;
  return (
    <div className="record-picker">
      <RecordSearch label={`Search ${label.toLowerCase()} choices`} onSearch={list.search} />
      <TextField fullWidth select label={label} variant="outlined" size="small"
        SelectProps={{ native: true }} InputLabelProps={{ shrink: true }} value={value?.id ?? ''}
        disabled={!options.length}
        onChange={event => onChange(options.find(record => record.id === Number(event.target.value)) ?? null)}>
        <option value="">Select {label.toLowerCase()}</option>
        {options.map(record => <option key={record.id} value={record.id}>{format(record)}</option>)}
      </TextField>
      {!list.result && <p role="status">Loading choices…</p>}
      {list.result?.error && <p className="error-message" role="alert">
        {list.result.error} <Button type="button" onClick={() => setRevision(value => value + 1)}>Retry</Button>
      </p>}
      {list.result?.data && !records.length && <p className="muted">No matching choices.</p>}
      <RecordPager list={list} />
    </div>
  );
}
