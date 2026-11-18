import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import './App.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import { AppBar, Toolbar, Button, Card, TextField, Typography } from '@material-ui/core';
import { Dashboard, PAGES, canViewPage, pageHref, readPageHash, visiblePages } from './templates.jsx';
import UserManagement from './users.jsx';
import StaffAccounts from './staff.jsx';
import RegisterPage from './registers.jsx';
import PurchaseOrders from './purchase-orders.jsx';
import TransactionsPage from './inventory-transactions.jsx';
import { BackOrders, CadetKit, StockPage } from './inventory-pages.jsx';
import { queryId } from './inventory-ui.jsx';
import SettingsPage from './settings.jsx';

const transactionPages = ['receipts', 'issues', 'supplier-returns'];
const printPages = ['orders', 'back-orders', ...transactionPages];

// The interface and API share an origin. The browser sends the HttpOnly session
// cookie automatically; JavaScript never needs to read or store its token.
// A missing body means GET; supplying a body means a JSON POST.
async function api(path, body) {
  const response = await fetch(`/api/${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message || 'Request failed.'), { status: response.status });
  return data;
}

function App() {
  // `user` contains only the public account fields returned by worker.js.
  const [user, setUser] = useState(null);
  const [branding, setBranding] = useState({});
  const [operationalAccess, setOperationalAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState('');
  // Reused for sign-in and the current-password check; cleared after success.
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [hash, setHash] = useState(() => window.location.hash);
  const page = readPageHash(hash);
  const systemName = branding.name ?? 'RAFACSIMS';
  const shortName = branding.shortName ?? 'RAFACSIMS';

  useEffect(() => {
    let active = true;
    api('branding').then(data => {
      if (active) setBranding(current => ({ ...data, ...current }));
    }).catch(() => { /* Keep built-in branding available during a settings outage. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => { document.title = systemName; }, [systemName]);

  // Navigation is independent from authentication. A direct link cannot skip
  // the session-loading or mandatory password-change gates in the render below.
  useEffect(() => {
    const handleNavigation = () => {
      setHash(window.location.hash);
      setMessage('');
    };
    window.addEventListener('hashchange', handleNavigation);
    return () => window.removeEventListener('hashchange', handleNavigation);
  }, []);

  // Resolve workspace access separately so an access-check failure leaves
  // account features available. Ignore responses for a replaced session.
  useEffect(() => {
    if (!user || user.mustChangePassword) return;
    let active = true;
    api('operations/access')
      .then(({ canOperate }) => {
        if (active) setOperationalAccess({ user, allowed: canOperate === true });
      })
      .catch(error => {
        if (active) setOperationalAccess({ user, allowed: false, error: error.status === 403 ? '' : error.message });
      });
    return () => { active = false; };
  }, [user]);

  // Restore the existing session once at startup. Ignore a response arriving
  // after unmount instead of updating a component that is no longer active.
  useEffect(() => {
    let active = true;
    api('session').then(data => { if (active) setUser(data.user); })
      .catch(error => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  // Keep submission/loading/error behavior consistent across account actions.
  async function perform(action) {
    setBusy(true);
    setMessage('');
    try { await action(); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  // The response determines whether the account must replace its password.
  const login = event => {
    event.preventDefault();
    perform(async () => {
      const data = await api('login', { username, password });
      setUser(data.user);
      setPassword('');
    });
  };
  // Registration creates an ordinary account; it does not sign the user in.
  const register = () => perform(async () => {
    const data = await api('register', { username, password });
    setMessage(data.message);
    setPassword('');
  });
  // Clear local account/password state only after the server ends the session.
  const logout = () => perform(async () => {
    await api('logout', {});
    setUser(null);
    setPassword('');
    setNewPassword('');
    setConfirmation('');
    setChangingPassword(false);
  });
  // Confirm the new value here; worker.js verifies the current password,
  // invalidates older sessions and replaces the cookie after saving the change.
  const changePassword = event => {
    event.preventDefault();
    perform(async () => {
      if (newPassword !== confirmation) throw new Error('New passwords must match.');
      const data = await api('change-password', { currentPassword: password, newPassword });
      setUser(data.user);
      setPassword('');
      setNewPassword('');
      setConfirmation('');
      setChangingPassword(false);
      setMessage('Your password has been changed.');
    });
  };
  // This chooses the form to display. worker.js independently enforces the
  // first-login restriction, so hiding this form cannot bypass it.
  const mustChange = user && (user.mustChangePassword || changingPassword);
  const showWorkspace = !loading && user && !mustChange;
  const currentPage = PAGES[page];
  const access = operationalAccess?.user === user ? operationalAccess : null;
  const canOperate = access?.allowed === true;
  const accessHeading = currentPage.adminOnly
    ? 'Administrator access required'
    : access?.error ? 'Workspace access unavailable' : 'Staff access required';
  const query = new URLSearchParams(hash.split('?')[1]);

  function workspacePage() {
    const canCorrect = user.role === 'admin';
    switch (page) {
      case 'dashboard': return <Dashboard user={user} canOperate={canOperate} request={api} />;
      case 'users': return <UserManagement request={api} currentUser={user} />;
      case 'staff': return <StaffAccounts request={api} currentUser={user} />;
      case 'settings': return <SettingsPage request={api} onUpdated={update => setBranding(current => ({ ...current, ...update }))} />;
      case 'orders': return <PurchaseOrders key={hash} request={api} initialId={queryId(query, 'id')} canCorrect={canCorrect} />;
      case 'stock': return <StockPage key={hash} request={api} query={query} canCorrect={canCorrect} />;
      case 'back-orders': return <BackOrders key={hash} request={api} query={query} />;
      case 'cadet-kit': return <CadetKit key={hash} request={api} query={query} />;
      default: return transactionPages.includes(page)
        ? <TransactionsPage key={hash} request={api} page={page} query={query} canCorrect={canCorrect} />
        : <RegisterPage key={page} request={api} resource={page} canEdit={canCorrect} />;
    }
  }

  // Account forms keep their original handlers. Only the old signed-in welcome
  // panel is expanded into a navigable workspace; protected pages mount last.
  return (
    <div className={showWorkspace && printPages.includes(page) ? 'App print-record-page' : 'App'}
      style={!showWorkspace && branding.coverUrl ? { backgroundImage: `url("${branding.coverUrl}")` } : undefined}>
      <AppBar position="static"><Toolbar className="app-toolbar">
        <div className="app-brand">
          {branding.logoUrl && <img src={branding.logoUrl} alt="" />}
          <Typography variant="h6">{shortName}</Typography>
        </div>
        {user && <div className="account-controls">
          <span className="signed-in-name">{user.username}</span>
          {showWorkspace && <Button color="inherit" disabled={busy}
            onClick={() => { setChangingPassword(true); setMessage(''); }}>Change password</Button>}
          <Button color="inherit" disabled={busy} onClick={logout}>Log out</Button>
        </div>}
      </Toolbar></AppBar>
      <main className={showWorkspace ? 'workspace' : 'account-area'}>
        {showWorkspace ? (
          <div className="workspace-shell">
            <aside className="workspace-sidebar">
              <p className="eyebrow">Workspace</p>
              <nav aria-label="Main navigation">
                {visiblePages(user, canOperate).map(([key, item]) => (
                  <a key={key} href={pageHref(key)} aria-current={page === key ? 'page' : undefined}>
                    {item.title}
                  </a>
                ))}
              </nav>
            </aside>
            <section className="workspace-content" aria-label="Page content">
              {message && <p className="message-banner" role="status" aria-live="polite">{message}</p>}
              {access?.error && <p className="error-message" role="alert">Workspace access check failed. {access.error}</p>}
              {currentPage.operational && !access ? (
                <p role="status">Checking workspace access…</p>
              ) : !canViewPage(currentPage, user, canOperate) ? (
                <Card className="workspace-card" variant="outlined">
                  <Typography variant="h5" component="h1">{accessHeading}</Typography>
                  {currentPage.operational && !access?.error && <p>Ask an administrator to link your login to Staff Accounts.</p>}
                  <Button component="a" href={pageHref('dashboard')} color="primary">Return to Dashboard</Button>
                </Card>
              ) : workspacePage()}
            </section>
          </div>
        ) : (
        <Card className="account-card">
          {loading ? <Typography>Loading your session…</Typography> : mustChange ? (
            <form onSubmit={changePassword}>
              <Typography variant="h5" component="h1">Change your password</Typography>
              <p>{user.mustChangePassword ? 'You must replace your initial password before continuing.' : 'Choose a new password for your account.'}</p>
              <TextField fullWidth required label="Current password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
              <TextField fullWidth required label="New password" type="password" autoComplete="new-password" value={newPassword} inputProps={{ minLength: 12, maxLength: 128 }} onChange={e => setNewPassword(e.target.value)} helperText="Use 12–128 characters." />
              <TextField fullWidth required label="Confirm new password" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} />
              <Button type="submit" variant="contained" color="primary" disabled={busy}>Save password</Button>
            </form>
          ) : (
            <form onSubmit={login}>
              {systemName !== shortName && <Typography>{systemName}</Typography>}
              <Typography variant="h5" component="h1">Sign in or register</Typography>
              <TextField fullWidth required label="Username" autoComplete="username" value={username} inputProps={{ maxLength: 40 }} onChange={e => setUsername(e.target.value)} />
              <TextField fullWidth required label="Password" type="password" autoComplete="current-password" value={password} inputProps={{ maxLength: 128 }} onChange={e => setPassword(e.target.value)} />
              <Button type="submit" variant="contained" color="primary" disabled={busy}>Sign in</Button>
              <Button type="button" disabled={busy} onClick={register}>Register</Button>
              <p>New accounts require a password of at least 12 characters.</p>
            </form>
          )}
          {message && <p role="status" aria-live="polite">{message}</p>}
        </Card>
        )}
      </main>
    </div>
  );
}

ReactDOM.render(<App />, document.getElementById('root'));
