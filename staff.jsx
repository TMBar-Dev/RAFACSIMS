import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, TextField, Typography } from '@material-ui/core';

export default function StaffAccounts({ request, currentUser }) {
  const [staff, setStaff] = useState([]);
  const [cursors, setCursors] = useState([0]);
  const [nextCursor, setNextCursor] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [accountMode, setAccountMode] = useState('create');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('user');
  const [password, setPassword] = useState('');
  const mounted = useRef(true);
  const cursor = cursors[cursors.length - 1];

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Cancel stale reads when paging or leaving. API authorization remains the
  // authority if a session expires or its administrator role changes mid-page.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setListError('');
    request(`staff?after=${cursor}`)
      .then(data => {
        if (!active) return;
        setStaff(data.staff);
        setNextCursor(data.nextCursor);
      })
      .catch(error => {
        if (!active) return;
        setStaff([]);
        setNextCursor(null);
        setListError(error.message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, cursor, refresh]);

  function changeAccountMode() {
    setAccountMode(mode => mode === 'create' ? 'existing' : 'create');
    // Never retain hidden temporary passwords after choosing an existing login.
    setPassword('');
    setRole('user');
    setFormError('');
  }

  async function createStaffAccount(event) {
    event.preventDefault();
    if (saving) return;
    setNotice('');
    setFormError('');
    const body = accountMode === 'create'
      ? { username, password, role }
      : { accountMode, username };
    setSaving(true);
    try {
      const result = await request('staff', body);
      if (!mounted.current) return;
      setNotice(`${username.trim()}: ${result.message}`);
      setUsername('');
      setPassword('');
      setRole('user');
      // Keep successful writes distinct from a failed subsequent directory read.
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
        <Typography variant="h4" component="h1">Staff Accounts</Typography>
        <p>Create a staff login or link an existing account.</p>
      </header>
      <Card className="workspace-card" variant="outlined">
        <div className="section-heading">
          <Typography variant="h6" component="h2">
            {accountMode === 'create' ? 'Add a staff account' : 'Link an existing account'}
          </Typography>
          <Button type="button" variant="outlined" disabled={saving} onClick={changeAccountMode}>
            {accountMode === 'create' ? 'Use an existing login' : 'Create a new login'}
          </Button>
        </div>
        <form onSubmit={createStaffAccount} className="create-user-form" aria-busy={saving} autoComplete="off">
          <div className="detail-grid">
            <TextField required disabled={disabled} label="Username"
              variant="outlined" size="small" value={username} autoComplete="off"
              inputProps={{ minLength: 3, maxLength: 40, pattern: '[a-zA-Z0-9_.\\-]{3,40}' }}
              onChange={event => setUsername(event.target.value)} />
            {accountMode === 'create' && (
              <>
                <TextField required disabled={disabled} label="Password" type="password"
                  autoComplete="new-password" variant="outlined" size="small" value={password}
                  inputProps={{ minLength: 12, maxLength: 128 }} onChange={event => setPassword(event.target.value)}
                  helperText="12-128 characters. The user must change it on first sign-in." />
                <TextField required disabled={disabled} select label="Role" variant="outlined" size="small"
                  SelectProps={{ native: true }} value={role} onChange={event => setRole(event.target.value)}>
                  <option value="user">User</option>
                  <option value="admin">Administrator</option>
                </TextField>
              </>
            )}
          </div>
          <Button type="submit" variant="contained" color="primary" disabled={disabled}>
            {saving ? 'Saving...' : accountMode === 'create' ? 'Create staff account' : 'Link existing login'}
          </Button>
          {formError && <p className="error-message" role="alert">{formError}</p>}
          {notice && <p className="message-banner" role="status" aria-live="polite">{notice}</p>}
        </form>
      </Card>
      <Card className="workspace-card" variant="outlined" aria-busy={loading}>
        <div className="section-heading">
          <Typography variant="h6" component="h2">Staff directory</Typography>
          <Button variant="outlined" disabled={loading || saving} onClick={() => setRefresh(value => value + 1)}>Refresh list</Button>
        </div>
        {loading ? <p role="status">Loading staff accounts...</p> : listError ? (
          <p className="error-message" role="alert">{listError} Use Refresh list to try again.</p>
        ) : (
          <div className="table-scroll" role="region" aria-label="Staff accounts" tabIndex={0}>
            <table className="records-table">
              <caption className="visually-hidden">Staff accounts, page {cursors.length}.</caption>
              <thead><tr><th scope="col">Username</th><th scope="col">Role</th><th scope="col">Sign-in status</th></tr></thead>
              <tbody>
                {staff.map(person => (
                  <tr key={person.id}>
                    <td>{person.account ? <>{person.account.username}{person.account.username.toLowerCase() === currentUser.username.toLowerCase() && <span className="current-user-label"> (you)</span>}</> : 'No linked login'}</td>
                    <td>{person.account ? (person.account.role === 'admin' ? 'Administrator' : 'User') : '\u2014'}</td>
                    <td>{person.account ? <span className={!person.account.active || person.account.mustChangePassword ? 'password-status pending' : 'password-status'}>
                      {!person.account.active ? 'Deactivated' : person.account.mustChangePassword ? 'Change required' : 'Ready'}
                    </span> : '\u2014'}</td>
                  </tr>
                ))}
                {!staff.length && <tr><td colSpan={3}>No staff records on this page.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination-controls">
          <Button disabled={loading || saving || cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>Previous</Button>
          <span className="muted">Page {cursors.length}{!loading && !listError ? ` - ${staff.length} records shown` : ''}</span>
          <Button disabled={loading || saving || nextCursor === null || Boolean(listError)} onClick={() => setCursors(values => [...values, nextCursor])}>Next</Button>
        </div>
      </Card>
    </>
  );
}
