import { constraintError, fail, integer } from './management.js';
import { permissionMask } from './account-permissions.js';

export const ACCOUNT_ADMIN_SCHEMA = [
  // A disabled login keeps its staff account ID and operational history.
  `CREATE TABLE IF NOT EXISTS account_deactivations (
    user_id INTEGER PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    actor_name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE TRIGGER IF NOT EXISTS revoke_sessions_after_deactivation
    AFTER INSERT ON account_deactivations BEGIN
      DELETE FROM sessions WHERE user_id = NEW.user_id;
    END`,
  `CREATE TRIGGER IF NOT EXISTS revoke_sessions_after_identity_edit
    AFTER UPDATE OF username, role ON staff
    WHEN OLD.username COLLATE BINARY != NEW.username OR OLD.role != NEW.role BEGIN
      DELETE FROM sessions WHERE user_id = NEW.id;
    END`
];

export const ACCOUNT_ACTIVE = 'NOT EXISTS (SELECT 1 FROM account_deactivations d WHERE d.user_id = staff.id)';

// Recheck the author's authority in the write. A ready administrator can only
// administer other accounts, so two admins cannot disable each other in a race.
export const LIVE_ADMIN = `EXISTS (
  SELECT 1 FROM sessions JOIN staff ON staff.id = sessions.user_id
  WHERE sessions.token_hash = ? AND sessions.expires_at > unixepoch()
    AND staff.role = 'admin' AND staff.must_change_password = 0 AND ${ACCOUNT_ACTIVE}
)`;

export async function administerAccount(db, actor, targetId, action, body, preparePassword) {
  const id = integer(Number(targetId), 'Account ID');
  if (id === actor.id) fail('Another administrator must manage this account. Use Change password for your own password.', 409);
  const target = await db.prepare('SELECT username, role, password_hash, permissions FROM staff WHERE id = ?').bind(id).first();
  if (!target) fail('Account not found.', 404);
  const authority = actor.token_hash;
  let result;
  switch (action) {
    case 'edit': {
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      if (!/^[a-zA-Z0-9_.-]{2,40}$/.test(username))
        fail('Username must contain 2–40 letters, numbers, dots, underscores or hyphens.');
      if (username !== target.username && [username, target.username].some(name => name.toLowerCase() === 'admin'))
        fail('The bootstrap administrator username is reserved.', 409);
      if (!['admin', 'user'].includes(body.role)) fail('Choose a valid account role.');
      if (body.previousUsername !== target.username || body.previousRole !== target.role)
        fail('The account changed. Refresh the account list and try again.', 409);
      const permissions = body.permissions === undefined ? target.permissions : permissionMask(body.permissions);
      if (body.permissions !== undefined && permissionMask(body.previousPermissions) !== target.permissions)
        fail('The account permissions changed. Refresh the account list and try again.', 409);
      try {
        result = await db.prepare(`UPDATE staff SET username = ?, role = ?, permissions = ?
          WHERE id = ? AND username COLLATE BINARY = ? AND role = ? AND permissions = ? AND ${LIVE_ADMIN} RETURNING id`)
          .bind(username, body.role, permissions, id, target.username, target.role, target.permissions, authority).first();
      } catch (error) {
        if (/UNIQUE constraint failed:\s*staff\.username/i.test(constraintError(error)))
          fail('That username is already registered.', 409);
        throw error;
      }
      if (result) return { message: 'Account details saved.' };
      break;
    }
    case 'reset-password': {
      const hash = await preparePassword(body.password, target.password_hash);
      const [updated] = await db.batch([
        db.prepare(`UPDATE staff SET password_hash = ?, must_change_password = 1
          WHERE id = ? AND password_hash = ? AND ${LIVE_ADMIN}`).bind(hash, id, target.password_hash, authority),
        db.prepare(`DELETE FROM sessions WHERE user_id = ?
          AND EXISTS (SELECT 1 FROM staff WHERE id = ? AND password_hash = ?)`).bind(id, id, hash)
      ]);
      if (updated.meta.changes) return { message: 'Temporary password set. Previous sessions were revoked.' };
      break;
    }
    case 'deactivate':
      result = await db.prepare(`INSERT INTO account_deactivations (user_id, actor_id, actor_name)
        SELECT id, ?, ? FROM staff WHERE id = ? AND ${LIVE_ADMIN}
        ON CONFLICT(user_id) DO NOTHING RETURNING user_id`).bind(actor.id, actor.username, id, authority).first();
      if (result) return { message: 'Account deactivated. Previous sessions were revoked.' };
      break;
    case 'reactivate':
      result = await db.prepare(`DELETE FROM account_deactivations
        WHERE user_id = ? AND ${LIVE_ADMIN} RETURNING user_id`).bind(id, authority).first();
      if (result) return { message: 'Account reactivated. The user can sign in again.' };
      break;
  }
  fail('The account or your session changed. Refresh the account list and try again.', 409);
}
