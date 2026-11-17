import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import './App.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import { AppBar, Toolbar, Button, Card, TextField, Typography } from '@material-ui/core';

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
  if (!response.ok) throw new Error(data.message || 'Request failed.');
  return data;
}

function App() {
  // `user` contains only the public account fields returned by worker.js.
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState('');
  // Reused for sign-in and the current-password check; cleared after success.
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

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

  // Render in order: session loading, password change, signed in, signed out.
  return (
    <div className="App">
      <AppBar position="static"><Toolbar style={{ justifyContent: 'space-between' }}>
        <Typography variant="h6">RAFACSIMS</Typography>
        {user && <Button color="inherit" disabled={busy} onClick={logout}>Log out</Button>}
      </Toolbar></AppBar>
      <main>
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
          ) : user ? (
            <>
              <Typography variant="h5" component="h1">Welcome, {user.username}</Typography>
              <p>You are signed in{user.role === 'admin' ? ' as an administrator' : ''}.</p>
              <Button disabled={busy} onClick={() => { setChangingPassword(true); setMessage(''); }}>Change password</Button>
            </>
          ) : (
            <form onSubmit={login}>
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
      </main>
    </div>
  );
}

ReactDOM.render(<App />, document.getElementById('root'));
