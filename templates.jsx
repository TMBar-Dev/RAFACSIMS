import React from 'react';
import { Button, Card, TextField, Typography } from '@material-ui/core';
import { PurchaseOrderSummary } from './purchase-orders.jsx';

// One registry keeps navigation, headings and direct hash links consistent.
// Stock remains a template until receiving adds inventory movements.
export const PAGES = {
  dashboard: { title: 'Dashboard', description: 'Your squadron workspace at a glance.' },
  cadets: {
    title: 'Cadets',
    operational: true,
    implemented: true,
    description: 'A place for cadet records, flights and service information.',
  },
  orders: {
    title: 'Orders', operational: true, implemented: true,
    description: 'Create and view purchase orders by supplier.'
  },
  suppliers: {
    title: 'Suppliers', adminOnly: true, implemented: true,
    description: 'Maintain suppliers and their contact details.'
  },
  catalog: {
    title: 'Item Catalog', adminOnly: true, implemented: true,
    description: 'Maintain supplier items, uniform types and sizes.'
  },
  stock: {
    title: 'Stock Management',
    operational: true,
    description: 'A place for uniform, equipment, quantities and issue records.',
    singular: 'stock item',
    columns: ['Reference', 'Description', 'Category', 'Size', 'Quantity', 'Location', 'Actions'],
    filters: ['All categories', 'All locations'],
    fields: ['Item reference', 'Description', 'Category', 'Size', 'Quantity', 'Location'],
    summaries: ['Stock items', 'Items issued', 'Low-stock items']
  },
  staff: {
    title: 'Staff Accounts',
    description: 'Create staff logins or link existing accounts.',
    implemented: true,
    adminOnly: true
  },
  users: {
    title: 'User Management',
    description: 'Create sign-in accounts and review first-login password status.',
    adminOnly: true,
    implemented: true
  }
};

// Hash links survive refresh and browser Back/Forward without another router
// dependency or changes to the Worker API. Unknown routes resolve to Dashboard.
export function readPageHash(hash = window.location.hash) {
  const key = hash.replace(/^#\/?/, '');
  return Object.prototype.hasOwnProperty.call(PAGES, key) ? key : 'dashboard';
}

export function pageHref(key) {
  return `#/${key}`;
}

// Use the same visibility rules for links and direct routes. The Worker
// checks the live session and staff link before serving operational data.
export function canViewPage(page, user, canOperate) {
  if (page.adminOnly) return user.role === 'admin';
  if (page.operational) return canOperate;
  return true;
}

export function visiblePages(user, canOperate) {
  return Object.entries(PAGES).filter(([, page]) => canViewPage(page, user, canOperate));
}

export function Dashboard({ user, canOperate, request }) {
  const modules = visiblePages(user, canOperate).filter(([key]) => key !== 'dashboard');
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Squadron workspace</p>
        <Typography variant="h4" component="h1">Welcome, {user.username}</Typography>
        {modules.length > 0 && <p>Choose an area below to open your workspace.</p>}
      </header>
      {canOperate && <PurchaseOrderSummary request={request} />}
      {modules.length > 0 && <div className="module-grid">
        {modules.map(([key, page]) => (
          <Card key={key} className="module-card" variant="outlined">
            {!page.implemented && <span className="template-badge">Page template</span>}
            <Typography variant="h6" component="h2">{page.title}</Typography>
            <p>{page.description}</p>
            <Button component="a" href={pageHref(key)} variant="contained" color="primary">
              Open {page.title}
            </Button>
          </Card>
        ))}
      </div>}
      <Card className="workspace-card" variant="outlined">
        <Typography variant="h6" component="h2">Your account</Typography>
        <dl className="account-details">
          <div><dt>Username</dt><dd>{user.username}</dd></div>
          <div><dt>Role</dt><dd>{user.role === 'admin' ? 'Administrator' : 'Member'}</dd></div>
        </dl>
        <p>Use the account controls at the top to change your password or sign out.</p>
      </Card>
    </>
  );
}

// Every management page shares an empty-state/table layout. Keeping column and
// field definitions together makes it straightforward to adapt recovered pages.
// Disabled controls intentionally cannot collect or pretend to save user data.
export function ManagementTemplate({ pageKey }) {
  const page = PAGES[pageKey];
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Management</p>
        <Typography variant="h4" component="h1">{page.title}</Typography>
        <p>{page.description}</p>
      </header>
      <div className="template-notice" role="note">
        <strong>Page template only</strong>
        <p>No {page.singular} records are loaded or saved. Search, editing, import and export are not connected yet.</p>
      </div>
      <div className="summary-grid">
        {page.summaries.map(label => (
          <Card key={label} className="summary-card" variant="outlined">
            <Typography component="h2" variant="subtitle2">{label}</Typography>
            <span className="summary-value" aria-label="Not available">&mdash;</span>
            <span className="muted">No records connected</span>
          </Card>
        ))}
      </div>
      <Card className="workspace-card" variant="outlined">
        <div className="section-heading">
          <Typography variant="h6" component="h2">{page.title} directory</Typography>
          <div className="template-actions">
            <Button disabled variant="contained" color="primary">Add {page.singular}</Button>
            <Button disabled variant="outlined">Import</Button>
            <Button disabled variant="outlined">Export</Button>
          </div>
        </div>
        <p className="muted">Record controls will become available when this page is connected.</p>
        <div className="template-filters">
          <TextField disabled label={`Search ${page.title.toLowerCase()}`} variant="outlined" size="small" />
          {page.filters.map(label => (
            <TextField key={label} disabled select label={label} variant="outlined" size="small"
              SelectProps={{ native: true }} defaultValue="all">
              <option value="all">{label}</option>
            </TextField>
          ))}
        </div>
        <div className="table-scroll" role="region" aria-label={`${page.title} table`} tabIndex={0}>
          <table className="records-table">
            <caption className="visually-hidden">{page.title} template. No records connected.</caption>
            <thead><tr>{page.columns.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>
              <tr><td colSpan={page.columns.length}>
                <div className="empty-state">
                  <Typography variant="h6" component="h3">No records connected</Typography>
                  <p>This space is reserved for your {page.singular} records.</p>
                  <span className="template-badge">Template view</span>
                </div>
              </td></tr>
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="workspace-card" variant="outlined">
        <Typography variant="h6" component="h2">Record details preview</Typography>
        <p className="muted">A suggested layout for a {page.singular} record. These fields are disabled.</p>
        <div className="detail-grid">
          {page.fields.map(label => <TextField key={label} disabled label={label} variant="outlined" size="small" />)}
        </div>
      </Card>
    </>
  );
}
