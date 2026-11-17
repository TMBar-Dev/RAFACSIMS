import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, TextField, Typography } from '@material-ui/core';

function createdDate(seconds) {
  if (!Number.isInteger(seconds) || seconds <= 0) return 'Unknown';
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);
}

// The API independently checks the live session and administrator role.
// Passwords stay in form state until submission and are never stored locally.
export default function UserManagement({ request, currentUser }) {
  const [accounts, setAccounts] = useState([]);
  const [cursors, setCursors] = useState([0]);
  const [nextCursor, setNextCursor] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [role, setRole] = useState('user');
  const mounted = useRef(true);
  const cursor = cursors[cursors.length - 1];

  // Navigation/logout can unmount this page during an account request.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Cursor history supports Previous/Next without downloading every account.
  // Ignore stale responses after paging, refreshing or leaving the page.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setListError('');
    request(`users?after=${cursor}`)
      .then(data => {
        if (!active) return;
        setAccounts(data.users);
        setNextCursor(data.nextCursor);
      })
      .catch(error => {
        if (!active) return;
        setAccounts([]);
        setNextCursor(null);
        setListError(error.message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, cursor, refresh]);

  async function createAccount(event) {
    event.preventDefault();
    if (saving) return;
    setFormError('');
    setNotice('');
    if (password !== confirmation) {
      setFormError('Temporary passwords must match.');
      return;
    }
    setSaving(true);
    try {
      const data = await request('users', { username, password, role });
      if (!mounted.current) return;
      setNotice(`${username.trim()}: ${data.message}`);
      setUsername('');
      setPassword('');
      setConfirmation('');
      setRole('user');
      // Creation and refresh are separate. A later read error must not imply
      // that a successful account creation failed and needs resubmitting.
      setCursors([0]);
      setRefresh(value => value + 1);
    } catch (error) {
      if (mounted.current) setFormError(error.message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  const disabled = saving || loading || Boolean(listError);
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Administration</p>
        <Typography variant="h4" component="h1">User Management</Typography>
        <p>Create sign-in accounts and see which users need to change their temporary password.</p>
      </header>
      <Card className="workspace-card" variant="outlined">
        <Typography variant="h6" component="h2">Create a user</Typography>
        <p className="muted">New users must change their temporary password on first login. Existing accounts are not modified.</p>
        <form onSubmit={createAccount} className="create-user-form" aria-busy={saving}>
          <div className="detail-grid">
            <TextField required disabled={disabled} label="Username" variant="outlined" size="small"
              value={username} autoComplete="off" onChange={event => setUsername(event.target.value)}
              inputProps={{ minLength: 3, maxLength: 40, pattern: '[a-zA-Z0-9_.\\-]{3,40}' }}
              helperText="3-40 letters, numbers, dots, underscores or hyphens." />
            <TextField required disabled={disabled} select label="Role" variant="outlined" size="small"
              SelectProps={{ native: true }} value={role} onChange={event => setRole(event.target.value)}>
              <option value="user">Member</option>
              <option value="admin">Administrator</option>
            </TextField>
          </div>
          <div className="detail-grid">
            <TextField required disabled={disabled} label="Temporary password" type="password"
              variant="outlined" size="small" autoComplete="new-password" value={password}
              onChange={event => setPassword(event.target.value)} inputProps={{ minLength: 12, maxLength: 128 }}
              helperText="12-128 characters. Share it with the user separately." />
            <TextField required disabled={disabled} label="Confirm temporary password" type="password"
              variant="outlined" size="small" autoComplete="new-password" value={confirmation}
              onChange={event => setConfirmation(event.target.value)} inputProps={{ minLength: 12, maxLength: 128 }} />
          </div>
          <p className="muted">An administrator can create other accounts. Choose Member unless administrator access is needed.</p>
          <Button type="submit" variant="contained" color="primary" disabled={disabled}>
            {saving ? 'Creating user...' : 'Create user'}
          </Button>
          {formError && <p className="error-message" role="alert">{formError}</p>}
          {notice && <p className="message-banner" role="status" aria-live="polite">{notice}</p>}
        </form>
      </Card>
      <Card className="workspace-card" variant="outlined" aria-busy={loading}>
        <div className="section-heading">
          <Typography variant="h6" component="h2">User accounts</Typography>
          <Button variant="outlined" disabled={loading || saving} onClick={() => setRefresh(value => value + 1)}>Refresh list</Button>
        </div>
        <p className="muted">Passwords are never displayed. This page creates accounts; it does not edit or delete existing users.</p>
        {loading ? <p role="status">Loading accounts...</p> : listError ? (
          <p className="error-message" role="alert">{listError} Use Refresh list to try again.</p>
        ) : (
          <div className="table-scroll" role="region" aria-label="User accounts" tabIndex={0}>
            <table className="records-table">
              <caption className="visually-hidden">User accounts, page {cursors.length}.</caption>
              <thead><tr><th scope="col">Username</th><th scope="col">Role</th><th scope="col">Password status</th><th scope="col">Created</th></tr></thead>
              <tbody>
                {accounts.map(account => (
                  <tr key={account.id}>
                    <td>{account.username}{account.username.toLowerCase() === currentUser.username.toLowerCase() && <span className="current-user-label"> (you)</span>}</td>
                    <td>{account.role === 'admin' ? 'Administrator' : 'Member'}</td>
                    <td><span className={account.mustChangePassword ? 'password-status pending' : 'password-status'}>
                      {account.mustChangePassword ? 'Change required' : 'Ready'}
                    </span></td>
                    <td>{createdDate(account.createdAt)}</td>
                  </tr>
                ))}
                {!accounts.length && <tr><td colSpan={4}>No accounts on this page.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination-controls">
          <Button disabled={loading || saving || cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>Previous</Button>
          <span className="muted">Page {cursors.length}{!loading && !listError ? ` - ${accounts.length} accounts shown` : ''}</span>
          <Button disabled={loading || saving || nextCursor === null || Boolean(listError)}
            onClick={() => setCursors(values => [...values, nextCursor])}>Next</Button>
        </div>
      </Card>
    </>
  );
}
