import React from 'react';
import { Button, Card, Typography } from '@material-ui/core';
import { PurchaseOrderSummary } from './purchase-orders.jsx';
import { BackOrderSummary } from './inventory-pages.jsx';

// One registry keeps navigation, headings and direct hash links consistent.
export const PAGES = {
  dashboard: { title: 'Dashboard', description: 'Your squadron workspace at a glance.' },
  cadets: {
    title: 'Cadets',
    operational: true,
    description: 'A place for cadet records, flights and service information.',
  },
  orders: {
    title: 'Orders', operational: true,
    description: 'Create and view purchase orders by supplier.'
  },
  suppliers: {
    title: 'Suppliers', adminOnly: true,
    description: 'Maintain suppliers and their contact details.'
  },
  catalog: {
    title: 'Item Catalog', adminOnly: true,
    description: 'Maintain supplier items, uniform types and sizes.'
  },
  receipts: {
    title: 'Receiving', operational: true,
    description: 'Receive purchase orders and view receipt history.'
  },
  'back-orders': {
    title: 'Back Orders', operational: true,
    description: 'Track and receive units still due from suppliers.'
  },
  stock: {
    title: 'Stock Management', operational: true,
    description: 'View live quantities, size balances and stock movements.'
  },
  issues: {
    title: 'Issue Uniform', operational: true,
    description: 'Record uniform issued to cadets.'
  },
  'supplier-returns': {
    title: 'Supplier Returns', operational: true,
    description: 'Record stock sent back to suppliers.'
  },
  'cadet-kit': {
    title: 'Cadet Kit', operational: true,
    description: 'Review issue history and totals by cadet.'
  },
  staff: {
    title: 'Staff Accounts',
    description: 'Create staff logins or link existing accounts.',
    adminOnly: true
  },
  users: {
    title: 'User Management',
    description: 'Create sign-in accounts and review first-login password status.',
    adminOnly: true
  }
};

// Hash links survive refresh and browser Back/Forward without another router
// dependency or changes to the Worker API. Unknown routes resolve to Dashboard.
export function readPageHash(hash = window.location.hash) {
  const key = hash.replace(/^#\/?/, '').split('?')[0];
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
      {canOperate && <div className="inventory-summary">
        <PurchaseOrderSummary request={request} />
        <BackOrderSummary request={request} />
      </div>}
      {modules.length > 0 && <div className="module-grid">
        {modules.map(([key, page]) => (
          <Card key={key} className="module-card" variant="outlined">
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
