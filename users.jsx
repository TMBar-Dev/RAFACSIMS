import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, TextField, Typography } from '@mui/material';

function createdDate(seconds) {
  if (!Number.isInteger(seconds) || seconds <= 0) return 'Unknown';
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);
}

function AccountActions({ account, saving, error, onSave, onClose, onActionChange }) {
  const [action, setAction] = useState('edit');
  const [username, setUsername] = useState(account.username);
  const [role, setRole] = useState(account.role);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [validation, setValidation] = useState('');
  const heading = useRef(null);
  const bootstrap = account.username.toLowerCase() === 'admin';
  const accessAction = account.active ? 'deactivate' : 'reactivate';
  const accessLabel = account.active ? 'Deactivate' : 'Reactivate';

  useEffect(() => { heading.current?.focus(); }, []);

  function select(next) {
    setAction(next);
    setPassword('');
    setConfirmation('');
    setValidation('');
    onActionChange();
  }

  function submit(event) {
    event.preventDefault();
    setValidation('');
    if (action === 'reset-password' && password !== confirmation) {
      setValidation('Temporary passwords must match.');
      return;
    }
    const body = action === 'edit'
      ? { username, role, previousUsername: account.username, previousRole: account.role }
      : action === 'reset-password' ? { password } : {};
    onSave(action, body);
  }

  return (
    <Card className="workspace-card" variant="outlined">
      <div className="section-heading">
        <Typography variant="h6" component="h2" ref={heading} tabIndex={-1}>Manage {account.username}</Typography>
        <Button type="button" disabled={saving} onClick={onClose}>Close</Button>
      </div>
      <div className="record-tools" aria-label="Account actions">
        {[
          ['edit', 'Edit details'], ['reset-password', 'Reset password'], [accessAction, accessLabel]
        ].map(([value, label]) => <Button key={value} type="button" variant="outlined" aria-pressed={action === value}
          color={action === value ? 'primary' : 'inherit'} disabled={saving} onClick={() => select(value)}>{label}</Button>)}
      </div>
      <form onSubmit={submit} aria-busy={saving}>
        <fieldset className="record-fieldset" disabled={saving}>
          {action === 'edit' ? (
            <>
              <div className="detail-grid">
                <TextField required disabled={bootstrap} label="Username" variant="outlined" size="small" value={username}
                  onChange={event => setUsername(event.target.value)}
                  helperText={bootstrap ? 'Reserved for the bootstrap account.' : '3–40 letters, numbers, dots, underscores or hyphens.'}
                  slotProps={{ htmlInput: { minLength: 3, maxLength: 40, pattern: '[a-zA-Z0-9_.\\-]{3,40}' } }} />
                <TextField required select label="Role" variant="outlined" size="small" value={role}
                  onChange={event => setRole(event.target.value)} slotProps={{ select: { native: true } }}>
                  <option value="user">Member</option>
                  <option value="admin">Administrator</option>
                </TextField>
              </div>
              <p className="muted">Changing the username or role signs this user out of all sessions.</p>
            </>
          ) : action === 'reset-password' ? (
            <>
              <div className="detail-grid">
                <TextField required label="Temporary password" type="password" autoComplete="new-password"
                  variant="outlined" size="small" value={password} onChange={event => setPassword(event.target.value)}
                  slotProps={{ htmlInput: { minLength: 12, maxLength: 128 } }} />
                <TextField required label="Confirm temporary password" type="password" autoComplete="new-password"
                  variant="outlined" size="small" value={confirmation} onChange={event => setConfirmation(event.target.value)}
                  slotProps={{ htmlInput: { minLength: 12, maxLength: 128 } }} />
              </div>
              <p className="muted">The user is signed out and must replace the temporary password on their next sign-in.</p>
            </>
          ) : <p>{account.active
            ? 'This signs the user out and blocks sign-in until an administrator reactivates the account. Their staff link and history are kept.'
            : 'The user can sign in again with their existing credentials. Any required password change still applies.'}</p>}
          <Button type="submit" variant="contained" color={action === 'deactivate' ? 'secondary' : 'primary'} disabled={saving}>
            {saving ? 'Saving…' : action === 'edit' ? 'Save details'
              : action === 'reset-password' ? 'Set temporary password' : `Confirm ${accessLabel.toLowerCase()}`}
          </Button>
        </fieldset>
        {(validation || error) && <p className="error-message" role="alert">{validation || error}</p>}
      </form>
    </Card>
  );
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
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null);
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

  async function saveAccount(action, body) {
    if (saving) return;
    setActionError('');
    setNotice('');
    setSaving(true);
    try {
      const result = await request(`users/${selected.id}/${action}`, body);
      if (!mounted.current) return;
      setSelected(null);
      setNotice(result.message);
      setRefresh(value => value + 1);
    } catch (error) {
      if (mounted.current) setActionError(error.message);
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
        <p>Create accounts, manage sign-in access, and reset temporary passwords.</p>
      </header>
      {notice && <p className="message-banner" role="status">{notice}</p>}
      {selected && <AccountActions key={selected.id} account={selected} error={actionError} saving={saving}
        onSave={saveAccount} onClose={() => setSelected(null)} onActionChange={() => setActionError('')} />}
      <Card className="workspace-card" variant="outlined">
        <Typography variant="h6" component="h2">Create a user</Typography>
        <p className="muted">New users must change their temporary password on first login. Existing accounts are not modified.</p>
        <form onSubmit={createAccount} className="create-user-form" aria-busy={saving}>
          <div className="detail-grid">
            <TextField required disabled={disabled} label="Username" variant="outlined" size="small"
              value={username} autoComplete="off" onChange={event => setUsername(event.target.value)}
              slotProps={{ htmlInput: { minLength: 3, maxLength: 40, pattern: '[a-zA-Z0-9_.\\-]{3,40}' } }}
              helperText="3-40 letters, numbers, dots, underscores or hyphens." />
            <TextField required disabled={disabled} select label="Role" variant="outlined" size="small"
              slotProps={{ select: { native: true } }} value={role} onChange={event => setRole(event.target.value)}>
              <option value="user">Member</option>
              <option value="admin">Administrator</option>
            </TextField>
          </div>
          <div className="detail-grid">
            <TextField required disabled={disabled} label="Temporary password" type="password"
              variant="outlined" size="small" autoComplete="new-password" value={password}
              onChange={event => setPassword(event.target.value)} slotProps={{ htmlInput: { minLength: 12, maxLength: 128 } }}
              helperText="12-128 characters. Share it with the user separately." />
            <TextField required disabled={disabled} label="Confirm temporary password" type="password"
              variant="outlined" size="small" autoComplete="new-password" value={confirmation}
              onChange={event => setConfirmation(event.target.value)} slotProps={{ htmlInput: { minLength: 12, maxLength: 128 } }} />
          </div>
          <p className="muted">An administrator can create other accounts. Choose Member unless administrator access is needed.</p>
          <Button type="submit" variant="contained" color="primary" disabled={disabled}>
            {saving ? 'Creating user...' : 'Create user'}
          </Button>
          {formError && <p className="error-message" role="alert">{formError}</p>}
        </form>
      </Card>
      <Card className="workspace-card" variant="outlined" aria-busy={loading}>
        <div className="section-heading">
          <Typography variant="h6" component="h2">User accounts</Typography>
          <Button variant="outlined" disabled={loading || saving} onClick={() => {
            setSelected(null);
            setRefresh(value => value + 1);
          }}>Refresh list</Button>
        </div>
        {loading ? <p role="status">Loading accounts...</p> : listError ? (
          <p className="error-message" role="alert">{listError} Use Refresh list to try again.</p>
        ) : (
          <div className="table-scroll" role="region" aria-label="User accounts" tabIndex={0}>
            <table className="records-table">
              <caption className="visually-hidden">User accounts, page {cursors.length}.</caption>
              <thead><tr><th scope="col">Username</th><th scope="col">Role</th><th scope="col">Sign-in status</th>
                <th scope="col">Created</th><th scope="col">Actions</th></tr></thead>
              <tbody>
                {accounts.map(account => (
                  <tr key={account.id}>
                    <td>{account.username}{account.username.toLowerCase() === currentUser.username.toLowerCase() && <span className="current-user-label"> (you)</span>}</td>
                    <td>{account.role === 'admin' ? 'Administrator' : 'Member'}</td>
                    <td><span className={!account.active || account.mustChangePassword ? 'password-status pending' : 'password-status'}>
                      {!account.active ? 'Deactivated' : account.mustChangePassword ? 'Change required' : 'Ready'}
                    </span></td>
                    <td>{createdDate(account.createdAt)}</td>
                    <td>{account.username.toLowerCase() === currentUser.username.toLowerCase()
                      ? <span className="muted">Your account</span>
                      : <Button type="button" disabled={saving} aria-label={`Manage ${account.username}`}
                        onClick={() => { setActionError(''); setNotice(''); setSelected(account); }}>Manage</Button>}</td>
                  </tr>
                ))}
                {!accounts.length && <tr><td colSpan={5}>No accounts on this page.</td></tr>}
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
