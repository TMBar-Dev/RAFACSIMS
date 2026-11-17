import React from 'react';
import { Button, Card, TextField, Typography } from '@material-ui/core';

// One registry keeps navigation, headings and direct hash links consistent.
// Cadets/Stock/Staff remain templates. User Management is a separate live page
// backed by the account API and is restricted to administrators.
export const PAGES = {
  dashboard: { title: 'Dashboard', description: 'Your squadron workspace at a glance.' },
  cadets: {
    title: 'Cadets',
    description: 'A place for cadet records, flights and service information.',
    singular: 'cadet',
    columns: ['Service number', 'Name', 'Rank', 'Flight', 'Status', 'Actions'],
    filters: ['All flights', 'All statuses'],
    fields: ['Service number', 'First name', 'Last name', 'Rank', 'Flight', 'Status'],
    summaries: ['Cadet records', 'Active cadets', 'Flights']
  },
  stock: {
    title: 'Stock Management',
    description: 'A place for uniform, equipment, quantities and issue records.',
    singular: 'stock item',
    columns: ['Reference', 'Description', 'Category', 'Size', 'Quantity', 'Location', 'Actions'],
    filters: ['All categories', 'All locations'],
    fields: ['Item reference', 'Description', 'Category', 'Size', 'Quantity', 'Location'],
    summaries: ['Stock items', 'Items issued', 'Low-stock items']
  },
  staff: {
    title: 'Staff Accounts',
    description: 'A place for staff profiles, account roles and access settings.',
    singular: 'staff account',
    adminOnly: true,
    columns: ['Name', 'Username', 'Role', 'Account status', 'Last sign-in', 'Actions'],
    filters: ['All roles', 'All account statuses'],
    fields: ['Display name', 'Username', 'Role', 'Account status'],
    summaries: ['Staff accounts', 'Administrators', 'Active accounts']
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

// The role check controls links, not data permissions. worker.js independently
// authorizes user-management requests; future staff APIs must do the same.
export function visiblePages(user) {
  return Object.entries(PAGES).filter(([, page]) => !page.adminOnly || user.role === 'admin');
}

export function Dashboard({ user }) {
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Squadron workspace</p>
        <Typography variant="h4" component="h1">Welcome, {user.username}</Typography>
        <p>Choose an area below to open your workspace.</p>
      </header>
      <div className="template-notice" role="note">
        <strong>Workspace status</strong>
        <p>Cadets, Stock Management and Staff Accounts are page templates. Administrators can use User Management to create sign-in accounts.</p>
      </div>
      <div className="module-grid">
        {visiblePages(user).filter(([key]) => key !== 'dashboard').map(([key, page]) => (
          <Card key={key} className="module-card" variant="outlined">
            <span className="template-badge">{page.implemented ? 'Account management' : 'Page template'}</span>
            <Typography variant="h6" component="h2">{page.title}</Typography>
            <p>{page.description}</p>
            <Button component="a" href={pageHref(key)} variant="contained" color="primary">
              Open {page.title}
            </Button>
          </Card>
        ))}
      </div>
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
