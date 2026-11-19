import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, TextField, Typography } from '@mui/material';
import { RecordPager, RecordPicker, RecordSearch, useRecords, useResource } from './management-ui.jsx';

const activeStatuses = { active: 'Active', inactive: 'Inactive' };
const types = { blue: 'Blue', green: 'Green' };
const statusField = { key: 'status', label: 'Status', options: activeStatuses };
const registers = {
  cadets: {
    title: 'Cadets', singular: 'cadet',
    label: record => `${record.first_name} ${record.last_name}`,
    columns: [['Name', record => `${record.first_name} ${record.last_name}`],
      ['Service number', 'service_number'], ['Rank', 'rank'], ['Flight', 'flight'], ['Status', 'status']],
    fields: [
      { key: 'first_name', label: 'First name', max: 100, required: true },
      { key: 'last_name', label: 'Last name', max: 100, required: true },
      { key: 'service_number', label: 'Service number', max: 40 },
      { key: 'rank', label: 'Rank', max: 80 },
      { key: 'flight', label: 'Flight', max: 80 },
      { key: 'date_joined', label: 'Joining date', type: 'date' },
      { ...statusField, options: { ...activeStatuses, left: 'Left' } }
    ]
  },
  suppliers: {
    title: 'Suppliers', singular: 'supplier', label: record => record.name,
    columns: [['Supplier', 'name'], ['Contact', 'contact_person'], ['Number', 'contact_number'], ['Status', 'status']],
    fields: [
      { key: 'name', label: 'Supplier name', max: 150, required: true },
      { key: 'address', label: 'Address', max: 400, multiline: true },
      { key: 'contact_person', label: 'Contact person', max: 100 },
      { key: 'contact_number', label: 'Contact number', max: 50, type: 'tel' },
      statusField
    ]
  },
  catalog: {
    title: 'Item Catalog', singular: 'item', label: record => record.name,
    columns: [['Item', 'name'], ['Supplier', 'supplier_name'], ['Type', 'uniform_type'], ['Status', 'status']],
    fields: [
      { key: 'name', label: 'Item name', max: 150, required: true },
      { key: 'description', label: 'Description', max: 500, multiline: true },
      { key: 'uniform_type', label: 'Uniform type', options: types }, statusField
    ]
  },
  variants: {
    title: 'Sizes', singular: 'size', label: record => record.size,
    columns: [['Size', 'size'], ['Status', 'status']],
    fields: [{ key: 'size', label: 'Size', max: 80, required: true }, statusField]
  }
};

function displayValue(key, value) {
  if (key === 'status') return activeStatuses[value] ?? (value === 'left' ? 'Left' : value);
  if (key === 'uniform_type') return types[value] ?? value;
  return value || '—';
}

function RegisterEditor({ request, resource, record, itemId, onSave, onCancel }) {
  const config = registers[resource];
  const [version] = useState(record?.version);
  const [values, setValues] = useState(() => Object.fromEntries(config.fields.map(field => [
    field.key, record?.[field.key] ?? Object.keys(field.options ?? {})[0] ?? ''
  ])));
  const [supplier, setSupplier] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const path = record ? `${resource}/${record.id}` : resource;
      const body = { ...values };
      if (record) body.version = version;
      if (!record && resource === 'catalog') body.supplier_id = supplier?.id;
      if (!record && resource === 'variants') body.item_id = itemId;
      const saved = await request(path, body);
      if (mounted.current) onSave(saved.id);
    } catch (error) {
      if (mounted.current) setError(error.message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <Card className="workspace-card" variant="outlined">
      <Typography component="h2" variant="h6">{record ? 'Edit' : 'Add'} {config.singular}</Typography>
      <form onSubmit={save} aria-busy={saving}>
        <fieldset disabled={saving} className="record-fieldset">
          {resource === 'catalog' && (record
            ? <p>Supplier: {record.supplier_name}</p>
            : <RecordPicker request={request} endpoint="suppliers?active=1" label="Supplier" value={supplier}
                onChange={setSupplier} format={option => option.name} />)}
          <div className="detail-grid">
            {config.fields.map(field => (
              <TextField key={field.key} label={field.label} variant="outlined" size="small"
                required={field.required} type={field.type} select={Boolean(field.options)}
                multiline={field.multiline}
                slotProps={{
                  select: { native: true },
                  inputLabel: field.options || field.type === 'date' ? { shrink: true } : undefined,
                  htmlInput: { maxLength: field.max, readOnly: Boolean(record && field.key === 'size') }
                }}
                value={values[field.key]} onChange={event => {
                  const value = event.target.value;
                  setValues(values => ({ ...values, [field.key]: value }));
                }}>
                {field.options && Object.entries(field.options).map(([value, label]) =>
                  <option key={value} value={value}>{label}</option>)}
              </TextField>
            ))}
          </div>
          <div className="record-tools">
            <Button type="submit" variant="contained" color="primary"
              disabled={saving || (!record && resource === 'catalog' && !supplier)}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" onClick={onCancel} disabled={saving}>Cancel</Button>
          </div>
        </fieldset>
        {error && <p className="error-message" role="alert">{error}</p>}
      </form>
    </Card>
  );
}

function RegisterPanel({ request, resource, canEdit, itemId }) {
  const config = registers[resource];
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const list = useRecords(request, itemId ? `variants?itemId=${itemId}` : resource, revision);
  const detail = useResource(request, selectedId ? `${resource}/${selectedId}` : null, revision);
  const record = detail?.data?.record;
  const records = list.result?.data?.records ?? [];

  function select(id, edit = false) {
    setNotice('');
    setSelectedId(id);
    setEditing(edit);
  }

  function saved(id) {
    select(id);
    setRevision(value => value + 1);
    setNotice(`${config.singular[0].toUpperCase() + config.singular.slice(1)} saved.`);
  }

  return (
    <>
      {notice && <p className="message-banner" role="status">{notice}</p>}
      {editing && (!selectedId || record) && <RegisterEditor key={selectedId ?? 'new'} request={request}
        resource={resource} record={record} itemId={itemId} onSave={saved}
        onCancel={() => setEditing(false)} />}
      {selectedId && !editing && (
        <Card className="workspace-card" variant="outlined" aria-busy={!detail}>
          <div className="section-heading">
            <Typography component="h2" variant="h6">{record ? config.label(record) : 'Record details'}</Typography>
            <div className="template-actions">
              {record && canEdit && <Button type="button" variant="outlined" onClick={() => setEditing(true)}>Edit</Button>}
              <Button type="button" onClick={() => select(null)}>Close details</Button>
            </div>
          </div>
          {!detail && <p role="status">Loading details…</p>}
          {detail?.error && <p className="error-message" role="alert">
            {detail.error} <Button type="button" onClick={() => setRevision(value => value + 1)}>Retry</Button>
          </p>}
          {record && <dl className="account-details">
            {resource === 'catalog' && <div><dt>Supplier</dt><dd>{record.supplier_name}</dd></div>}
            {config.fields.map(field => <div key={field.key}>
              <dt>{field.label}</dt><dd>{displayValue(field.key, record[field.key])}</dd>
            </div>)}
          </dl>}
        </Card>
      )}
      {resource === 'catalog' && record && !editing && (
        <RegisterPanel key={record.id} request={request} resource="variants" itemId={record.id} canEdit={canEdit} />
      )}
      <Card className="workspace-card" variant="outlined" aria-busy={!list.result}>
        <div className="section-heading">
          <Typography component="h2" variant="h6">{itemId ? config.title : `${config.title} register`}</Typography>
          <div className="template-actions">
            <Button type="button" onClick={() => setRevision(value => value + 1)} disabled={editing}>Refresh</Button>
            {canEdit && <Button type="button" variant="outlined" disabled={editing}
              onClick={() => select(null, true)}>Add {config.singular}</Button>}
          </div>
        </div>
        {!editing && <RecordSearch label={`Search ${config.title.toLowerCase()}`} onSearch={list.search} />}
        {!list.result ? <p role="status">Loading records…</p>
          : list.result.error ? <p className="error-message" role="alert">{list.result.error}</p>
          : <div className="table-scroll" role="region" aria-label={config.title} tabIndex={0}>
            <table className="records-table">
              <thead><tr>{config.columns.map(([label]) => <th key={label} scope="col">{label}</th>)}
                <th scope="col">Details</th></tr></thead>
              <tbody>
                {records.map(row => <tr key={row.id}>
                  {config.columns.map(([label, key]) => <td key={label}>
                    {typeof key === 'function' ? key(row) : displayValue(key, row[key])}</td>)}
                  <td><Button type="button" disabled={editing} aria-label={`View ${config.label(row)}`}
                    onClick={() => select(row.id)}>View</Button></td>
                </tr>)}
                {!records.length && <tr><td colSpan={config.columns.length + 1}>No matching records.</td></tr>}
              </tbody>
            </table>
          </div>}
        {!editing && <RecordPager list={list} />}
      </Card>
    </>
  );
}

export default function RegisterPage({ request, resource, canEdit, title }) {
  return (
    <>
      <header className="page-heading"><Typography component="h1" variant="h4">
        {title}
      </Typography></header>
      <RegisterPanel request={request} resource={resource} canEdit={canEdit} />
    </>
  );
}
