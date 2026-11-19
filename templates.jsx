import React from 'react';
import { Button, Card, Typography } from '@mui/material';
import { PurchaseOrderSummary } from './purchase-orders.jsx';
import { BackOrderSummary } from './inventory-pages.jsx';
import { useResource } from './management-ui.jsx';

// One registry keeps navigation, headings and direct hash links consistent.
export const PAGES = {
  dashboard: { title: 'Dashboard', description: 'Your squadron workspace at a glance.' },
  cadets: {
    title: 'Cadets',
    permissions: ['issue-kit'],
    description: 'A place for cadet records, flights and service information.',
  },
  orders: {
    title: 'Orders', permissions: ['stores-demands'],
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
    title: 'Receiving', permissions: ['stores-demands'],
    description: 'Receive purchase orders and view receipt history.'
  },
  'back-orders': {
    title: 'Back Orders', permissions: ['stores-demands'],
    description: 'Track and receive units still due from suppliers.'
  },
  stock: {
    title: 'Stock Management', permissions: ['issue-kit', 'return-kit', 'stores-demands'],
    description: 'View live quantities, size balances and stock movements.'
  },
  issues: {
    title: 'Issue Uniform', permissions: ['issue-kit'],
    description: 'Record uniform issued to cadets.'
  },
  'supplier-returns': {
    title: 'Supplier Returns', permissions: ['return-kit'],
    description: 'Record stock sent back to suppliers.'
  },
  'cadet-kit': {
    title: 'Cadet Kit', permissions: ['issue-kit'],
    description: 'Review issue history and totals by cadet.'
  },
  staff: {
    title: 'Staff Accounts',
    description: 'Manage sign-in accounts, roles, passwords and stores access.',
    adminOnly: true
  },
  settings: {
    title: 'Settings',
    description: 'Update the system name, logo, cover and About Us.',
    adminOnly: true
  }
};

// Hash links survive refresh and browser Back/Forward without another router
// dependency or changes to the Worker API. Unknown routes resolve to Dashboard.
export function readPageHash(hash = window.location.hash) {
  const key = hash.replace(/^#\/?/, '').split('?')[0];
  // Preserve links to User Management after moving its controls to Staff Accounts.
  if (key === 'users') return 'staff';
  return Object.prototype.hasOwnProperty.call(PAGES, key) ? key : 'dashboard';
}

export function pageHref(key) {
  return `#/${key}`;
}

// Use the same visibility rules for links and direct routes. The Worker
// checks the live session and stores access before serving operational data.
export function canViewPage(page, user, permissions) {
  if (page.adminOnly) return user.role === 'admin';
  if (page.permissions) return page.permissions.some(permission => permissions.includes(permission));
  return true;
}

export function visiblePages(user, permissions) {
  return Object.entries(PAGES).filter(([, page]) => canViewPage(page, user, permissions));
}

const navigationGroups = [
  ['Purchasing', ['orders', 'receipts', 'back-orders']],
  ['Stock and cadets', ['stock', 'issues', 'supplier-returns', 'cadets', 'cadet-kit']],
  ['Administration', ['suppliers', 'catalog', 'staff', 'settings']]
];

export function WorkspaceNavigation({ page, user, permissions }) {
  const available = new Set(visiblePages(user, permissions).map(([key]) => key));
  const link = key => (
    <a key={key} href={pageHref(key)} aria-current={page === key ? 'page' : undefined}>{PAGES[key].title}</a>
  );
  return (
    <aside className="workspace-sidebar">
      <nav aria-label="Main navigation">
        {link('dashboard')}
        {navigationGroups.map(([title, keys]) => {
          const links = keys.filter(key => available.has(key));
          if (!links.length) return null;
          const selected = links.includes(page);
          return (
            <details key={title} open={selected}>
              <summary className={selected ? 'current-group' : undefined}>{title}</summary>
              <div className="workspace-nav-links">{links.map(link)}</div>
            </details>
          );
        })}
      </nav>
    </aside>
  );
}

export function Dashboard({ user, permissions, request }) {
  const about = useResource(request, 'about')?.data?.aboutUs;
  const canView = key => canViewPage(PAGES[key], user, permissions);
  return (
    <>
      <header className="page-heading">
        <Typography variant="h4" component="h1">Dashboard</Typography>
        <p>{user.username} · {user.role === 'admin' ? 'Administrator' : permissions.length ? 'Staff' : 'User'}</p>
      </header>
      {canView('orders') && <div className="inventory-summary">
        <PurchaseOrderSummary request={request} />
        <BackOrderSummary request={request} />
      </div>}
      {canView('stock') && <Card className="workspace-card" variant="outlined">
        <Typography variant="h6" component="h2">Quick actions</Typography>
        <div className="dashboard-actions">
          {canView('issues') && <Button component="a" href="#/issues?create=1" variant="contained" color="primary">Issue uniform</Button>}
          <Button component="a" href={pageHref('stock')} variant="outlined" color="primary">Check stock</Button>
          {canView('cadet-kit') && <Button component="a" href={pageHref('cadet-kit')} variant="outlined" color="primary">View cadet kit</Button>}
        </div>
      </Card>}
      {about && <details className="dashboard-about">
        <summary>About Us</summary>
        <p className="about-copy">{about}</p>
      </details>}
    </>
  );
}
