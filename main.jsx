import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import './App.css';
import storesCover from './stores-cover.jpg';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import { AppBar, Toolbar, Button, Card, TextField, Typography } from '@mui/material';
import { createTheme, StyledEngineProvider, ThemeProvider } from '@mui/material/styles';
import { Dashboard, PAGES, WorkspaceNavigation, canViewPage, pageHref, readPageHash } from './templates.jsx';
import StaffAccounts from './staff.jsx';
import RegisterPage from './registers.jsx';
import PurchaseOrders from './purchase-orders.jsx';
import TransactionsPage from './inventory-transactions.jsx';
import { BackOrders, CadetKit, StockPage } from './inventory-pages.jsx';
import { queryId } from './inventory-ui.jsx';
import SettingsPage from './settings.jsx';

const transactionPages = ['receipts', 'issues', 'supplier-returns'];
const printPages = ['orders', 'back-orders', ...transactionPages];
const theme = createTheme({
  palette: { primary: { main: '#23415d' }, secondary: { main: '#9d3931' } },
  shape: { borderRadius: 8 },
  components: {
    // Preserve the sign-in fields and neutral buttons that used v4 defaults.
    MuiTextField: { defaultProps: { variant: 'standard' } },
    MuiButton: { defaultProps: { color: 'inherit' } }
  }
});

// The interface and API share an origin. The browser sends the HttpOnly session
// cookie automatically; JavaScript never needs to read or store its token.
// A missing body means GET; supplying a body means a JSON POST.
async function requestApi(path, body) {
  const response = await fetch(`/api/${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw Object.assign(new Error(data?.message || 'Request failed.'), { status: response.status });
  }
  return response.json();
}

function App() {
  // `user` contains only the public account fields returned by worker.js.
  const [user, setUser] = useState(null);
  const activeUser = useRef(null);
  const accessRequest = useRef(0);
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
  const [logoFailure, setLogoFailure] = useState(null);
  const [coverUrl, setCoverUrl] = useState(null);
  const page = readPageHash(hash);
  const systemName = branding.name ?? 'RAFACSIMS';
  const shortName = branding.shortName ?? 'RAFACSIMS';
  const logoUrl = branding.logoUrl && logoFailure?.primary === branding.logoUrl
    ? (logoFailure.hidden ? null : branding.logoFallbackUrl)
    : branding.logoUrl;

  const updateUser = useCallback(next => {
    activeUser.current = next;
    setUser(next);
  }, []);

  const clearSession = useCallback(expected => {
    // An older response must not sign out a newly established session.
    if (activeUser.current !== expected) return false;
    updateUser(null);
    setOperationalAccess(null);
    setPassword('');
    setNewPassword('');
    setConfirmation('');
    setChangingPassword(false);
    return true;
  }, [updateUser]);

  const api = useCallback(async (path, body) => {
    const startedWith = activeUser.current;
    try { return await requestApi(path, body); }
    catch (error) {
      if (error.status === 401 && path !== 'login' && startedWith && clearSession(startedWith))
        setMessage('Your session ended. Please sign in again.');
      throw error;
    }
  }, [clearSession]);

  useEffect(() => {
    let active = true;
    api('branding').then(data => {
      if (active) setBranding(current => ({ ...data, ...current }));
    }).catch(() => { /* Keep built-in branding available during a settings outage. */ });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    let active = true;
    async function chooseCover() {
      for (const url of [branding.coverUrl, branding.coverFallbackUrl]) {
        if (!url) continue;
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
        } catch { continue; }
        if (active) setCoverUrl(url);
        return;
      }
      if (active) setCoverUrl(null);
    }
    chooseCover();
    return () => { active = false; };
  }, [branding.coverUrl, branding.coverFallbackUrl]);

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

  // Access can change within a session. A slow reply must not replace a
  // newer permission check or restore access for an earlier session.
  const refreshOperationalAccess = useCallback(async currentUser => {
    if (!currentUser || currentUser.mustChangePassword) return;
    const requestNumber = ++accessRequest.current;
    const isCurrent = () => activeUser.current === currentUser && requestNumber === accessRequest.current;
    try {
      const { permissions } = await api('operations/access');
      if (isCurrent()) setOperationalAccess({ user: currentUser, permissions });
    } catch (error) {
      if (!isCurrent()) return;
      if (error.status === 403) {
        setOperationalAccess({ user: currentUser, permissions: [] });
      } else {
        // Retain a known result on a transient network or service failure.
        setOperationalAccess(previous => previous?.user === currentUser
          ? previous : { user: currentUser, error: error.message });
      }
    }
  }, [api]);

  useEffect(() => {
    refreshOperationalAccess(user);
    return () => { accessRequest.current += 1; };
  }, [refreshOperationalAccess, user]);

  // Restore the existing session once at startup. Ignore a response arriving
  // after unmount instead of updating a component that is no longer active.
  useEffect(() => {
    let active = true;
    api('session').then(data => { if (active) updateUser(data.user); })
      .catch(error => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, updateUser]);

  // A tab left open can still display loaded data after server-side expiry.
  // Refresh on return to the tab and periodically while it remains visible.
  useEffect(() => {
    if (!user) return;
    let active = true;
    async function checkSession() {
      if (document.visibilityState !== 'visible') return;
      try {
        const { user: current } = await api('session');
        if (!active || activeUser.current !== user) return;
        if (!current && clearSession(user)) {
          setMessage('Your session ended. Please sign in again.');
        } else if (current && (current.username !== user.username || current.role !== user.role ||
            current.mustChangePassword !== user.mustChangePassword)) {
          if (clearSession(user)) updateUser(current);
        } else if (current) {
          await refreshOperationalAccess(user);
        }
      } catch { /* A transient network failure is not proof of session expiry. */ }
    }
    const timer = window.setInterval(checkSession, 60_000);
    window.addEventListener('focus', checkSession);
    document.addEventListener('visibilitychange', checkSession);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', checkSession);
      document.removeEventListener('visibilitychange', checkSession);
    };
  }, [api, clearSession, refreshOperationalAccess, updateUser, user]);

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
      updateUser(data.user);
      setPassword('');
    });
  };
  // Registration creates an ordinary account; it does not sign the user in.
  const register = () => perform(async () => {
    const data = await api('register', { username, password });
    setMessage(data.message);
    setPassword('');
  });
  const logout = () => perform(async () => {
    const startedWith = activeUser.current;
    // An already-ended session still has a successful, cookie-clearing logout.
    await api('logout', {});
    clearSession(startedWith);
  });
  // Confirm the new value here; worker.js verifies the current password,
  // invalidates older sessions and replaces the cookie after saving the change.
  const changePassword = event => {
    event.preventDefault();
    perform(async () => {
      if (newPassword !== confirmation) throw new Error('New passwords must match.');
      const data = await api('change-password', { currentPassword: password, newPassword });
      updateUser(data.user);
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
  const permissions = access?.permissions ?? [];
  const accessHeading = currentPage.adminOnly
    ? 'Administrator access required'
    : access?.error ? 'Workspace access unavailable' : 'Workflow permission required';
  const query = new URLSearchParams(hash.split('?')[1]);

  function workspacePage() {
    const canCorrect = user.role === 'admin';
    const postingOwner = user.username.toLowerCase();
    switch (page) {
      case 'dashboard': return <Dashboard user={user} permissions={permissions} request={api} />;
      case 'staff': return <StaffAccounts request={api} currentUser={user} />;
      case 'settings': return <SettingsPage request={api} onUpdated={update => setBranding(current => ({ ...current, ...update }))} />;
      case 'orders': return <PurchaseOrders key={hash} request={api} initialId={queryId(query, 'id')} canCorrect={canCorrect}
        postingOwner={postingOwner} />;
      case 'stock': return <StockPage key={hash} request={api} query={query} canCorrect={canCorrect}
        canViewTransaction={key => canViewPage(PAGES[key], user, permissions)} />;
      case 'back-orders': return <BackOrders key={hash} request={api} query={query} />;
      case 'cadet-kit': return <CadetKit key={hash} request={api} query={query} />;
      default: return transactionPages.includes(page)
        ? <TransactionsPage key={hash} request={api} page={page} query={query} canCorrect={canCorrect} postingOwner={postingOwner} />
        : <RegisterPage key={page} request={api} resource={page} canEdit={canCorrect} />;
    }
  }

  // Account forms keep their original handlers. Only the old signed-in welcome
  // panel is expanded into a navigable workspace; protected pages mount last.
  return (
    <div className={showWorkspace ? (printPages.includes(page) ? 'App print-record-page' : 'App') : 'App account-app'}
      style={!showWorkspace ? { '--account-cover': `url("${coverUrl || storesCover}")` } : undefined}>
      <AppBar position="static" elevation={0} className="brand-bar"><Toolbar className="app-toolbar">
        <div className="app-brand">
          <img className={logoUrl ? undefined : 'default-brand-mark'} src={logoUrl || '/app-icon-192.png'} alt=""
            onError={logoUrl ? () => setLogoFailure({
              primary: branding.logoUrl, hidden: logoUrl === branding.logoFallbackUrl
            }) : undefined} />
          <Typography className="app-brand-title" variant="h6">{shortName}</Typography>
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
          <div className="workspace-shell" key={user.username.toLowerCase()}>
            <WorkspaceNavigation page={page} user={user} permissions={permissions} />
            <section className="workspace-content" aria-label="Page content">
              {message && <p className="message-banner" role="status" aria-live="polite">{message}</p>}
              {access?.error && <p className="error-message" role="alert">Workspace access check failed. {access.error}</p>}
              {currentPage.permissions && !access ? (
                <p role="status">Checking workspace access…</p>
              ) : !canViewPage(currentPage, user, permissions) ? (
                <Card className="workspace-card" variant="outlined">
                  <Typography variant="h5" component="h1">{accessHeading}</Typography>
                  {currentPage.permissions && !access?.error && <p>Ask an administrator to grant the required workflow permission in Staff Accounts.</p>}
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
              <TextField fullWidth required label="New password" type="password" autoComplete="new-password" value={newPassword} slotProps={{ htmlInput: { minLength: 12, maxLength: 128 } }} onChange={e => setNewPassword(e.target.value)} helperText="Use 12–128 characters." />
              <TextField fullWidth required label="Confirm new password" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} />
              <Button type="submit" variant="contained" color="primary" disabled={busy}>Save password</Button>
            </form>
          ) : (
            <form onSubmit={login}>
              {systemName !== shortName && <Typography>{systemName}</Typography>}
              <Typography variant="h5" component="h1">Sign in or register</Typography>
              <TextField fullWidth required label="Username" autoComplete="username" value={username} slotProps={{ htmlInput: { maxLength: 40 } }} onChange={e => setUsername(e.target.value)} />
              <TextField fullWidth required label="Password" type="password" autoComplete="current-password" value={password} slotProps={{ htmlInput: { maxLength: 128 } }} onChange={e => setPassword(e.target.value)} />
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

// Insert Emotion styles first so App.css can continue overriding MUI defaults.
ReactDOM.render(
  <StyledEngineProvider injectFirst>
    <ThemeProvider theme={theme}><App /></ThemeProvider>
  </StyledEngineProvider>,
  document.getElementById('root')
);
