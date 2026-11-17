import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, TextField, Typography } from '@material-ui/core';

// Profile data lives in staff; credentials and permissions continue to live in
// users. Both creation modes establish staff.user_id without duplicating hashes.
const PROFILE_FIELDS = [
  { name: 'firstName', label: 'First name', required: true, maxLength: 100 },
  { name: 'lastName', label: 'Last name', required: true, maxLength: 100 },
  { name: 'serviceNumber', label: 'Service number', maxLength: 40 },
  { name: 'rank', label: 'Rank', maxLength: 80 },
  { name: 'appointment', label: 'Appointment', maxLength: 120 },
  { name: 'email', label: 'Email', type: 'email', maxLength: 254 },
  { name: 'phone', label: 'Phone', type: 'tel', maxLength: 40 }
];
const EMPTY_PROFILE = Object.fromEntries(PROFILE_FIELDS.map(field => [field.name, '']));

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
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [accountMode, setAccountMode] = useState('create');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('user');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
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

  function changeAccountMode(event) {
    setAccountMode(event.target.value);
    // Never retain hidden temporary passwords after choosing an existing login.
    setPassword('');
    setConfirmation('');
    setRole('user');
    setFormError('');
  }

  async function createStaffAccount(event) {
    event.preventDefault();
    if (saving) return;
    setNotice('');
    setFormError('');
    if (accountMode === 'create' && password !== confirmation) {
      setFormError('Temporary passwords must match.');
      return;
    }
    const body = { ...profile, accountMode, username };
    // Existing-login mode cannot change its password or role. The server also
    // enforces this, rather than trusting which fields the browser displays.
    if (accountMode === 'create') Object.assign(body, { password, role });
    setSaving(true);
    try {
      const result = await request('staff', body);
      if (!mounted.current) return;
      setNotice(`${username.trim()}: ${result.message}`);
      setProfile(EMPTY_PROFILE);
      setUsername('');
      setPassword('');
      setConfirmation('');
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
        <p>Create a staff profile with a new login, or link it to an existing account.</p>
      </header>
      <Card className="workspace-card" variant="outlined">
        <Typography variant="h6" component="h2">Add a staff account</Typography>
        <p className="muted">The administrator account is included in the directory. Linking an existing login keeps its password and permissions.</p>
        <form onSubmit={createStaffAccount} className="create-user-form" aria-busy={saving} autoComplete="off">
          <Typography className="form-section-heading" variant="subtitle1" component="h3">Staff details</Typography>
          <div className="detail-grid">
            {PROFILE_FIELDS.map(field => (
              <TextField key={field.name} required={Boolean(field.required)} disabled={disabled}
                label={field.label} type={field.type || 'text'} variant="outlined" size="small"
                value={profile[field.name]} inputProps={{ maxLength: field.maxLength }}
                onChange={event => setProfile(values => ({ ...values, [field.name]: event.target.value }))} />
            ))}
          </div>
          <Typography className="form-section-heading" variant="subtitle1" component="h3">Login account</Typography>
          <div className="detail-grid">
            <TextField disabled={disabled} select label="Login setup" variant="outlined" size="small"
              SelectProps={{ native: true }} value={accountMode} onChange={changeAccountMode}>
              <option value="create">Create a new login</option>
              <option value="existing">Use an existing login</option>
            </TextField>
            <TextField required disabled={disabled} label={accountMode === 'create' ? 'New username' : 'Existing username'}
              variant="outlined" size="small" value={username} autoComplete="off"
              inputProps={{ minLength: 3, maxLength: 40, pattern: '[a-zA-Z0-9_.\\-]{3,40}' }}
              onChange={event => setUsername(event.target.value)} />
            {accountMode === 'create' && <TextField required disabled={disabled} select label="Login role"
              variant="outlined" size="small" SelectProps={{ native: true }} value={role}
              onChange={event => setRole(event.target.value)}>
              <option value="user">User</option>
              <option value="admin">Administrator</option>
            </TextField>}
          </div>
          {accountMode === 'create' ? (
            <>
              <p className="muted">New logins require a temporary password of 12-128 characters and a password change on first sign-in.</p>
              <div className="detail-grid">
                <TextField required disabled={disabled} label="Temporary password" type="password"
                  autoComplete="new-password" variant="outlined" size="small" value={password}
                  inputProps={{ minLength: 12, maxLength: 128 }} onChange={event => setPassword(event.target.value)} />
                <TextField required disabled={disabled} label="Confirm temporary password" type="password"
                  autoComplete="new-password" variant="outlined" size="small" value={confirmation}
                  inputProps={{ minLength: 12, maxLength: 128 }} onChange={event => setConfirmation(event.target.value)} />
              </div>
            </>
          ) : <p className="muted">Enter an existing username from User Management. No password reset or permission change will be made.</p>}
          <Button type="submit" variant="contained" color="primary" disabled={disabled}>
            {saving ? 'Saving staff account...' : 'Create staff account'}
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
        <p className="muted">Profile status describes the staff record; it does not disable the linked login. Editing and deletion are not enabled here yet.</p>
        {loading ? <p role="status">Loading staff accounts...</p> : listError ? (
          <p className="error-message" role="alert">{listError} Use Refresh list to try again.</p>
        ) : (
          <div className="table-scroll" role="region" aria-label="Staff accounts" tabIndex={0}>
            <table className="records-table">
              <caption className="visually-hidden">Staff accounts, page {cursors.length}.</caption>
              <thead><tr><th scope="col">Name</th><th scope="col">Service number</th><th scope="col">Login</th><th scope="col">Login role</th><th scope="col">Password status</th><th scope="col">Profile status</th></tr></thead>
              <tbody>
                {staff.map(person => (
                  <tr key={person.id}>
                    <td>{[person.rank, person.firstName, person.lastName].filter(Boolean).join(' ')}
                      {person.appointment && <span className="staff-appointment">{person.appointment}</span>}</td>
                    <td>{person.serviceNumber || '\u2014'}</td>
                    <td>{person.account ? <>{person.account.username}{person.account.username.toLowerCase() === currentUser.username.toLowerCase() && <span className="current-user-label"> (you)</span>}</> : 'No linked login'}</td>
                    <td>{person.account ? (person.account.role === 'admin' ? 'Administrator' : 'User') : '\u2014'}</td>
                    <td>{person.account ? <span className={person.account.mustChangePassword ? 'password-status pending' : 'password-status'}>{person.account.mustChangePassword ? 'Change required' : 'Ready'}</span> : '\u2014'}</td>
                    <td>{person.status === 'active' ? 'Active' : 'Inactive'}</td>
                  </tr>
                ))}
                {!staff.length && <tr><td colSpan={6}>No staff records on this page.</td></tr>}
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
