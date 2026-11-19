const PERMISSIONS_COLUMN = `permissions INTEGER NOT NULL DEFAULT 0
  CHECK(typeof(permissions) = 'integer' AND permissions BETWEEN 0 AND 7)`;

const CREATE_STAFF = `CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ${PERMISSIONS_COLUMN}
)`;

async function staffColumns(db) {
  const { results } = await db.prepare('PRAGMA table_info(staff)').all();
  return new Set(results.map(column => column.name));
}

function isAccountTable(columns) {
  return columns.has('username') && columns.has('permissions');
}

export async function initializeStaffSchema(db) {
  const columns = await staffColumns(db);
  if (isAccountTable(columns)) return;

  const users = await db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'users'").first();
  if (!users) {
    if (!columns.size) await db.prepare(CREATE_STAFF).run();
    else if (!isAccountTable(await staffColumns(db))) throw new Error('Incomplete staff migration: users table not found.');
    return;
  }

  // SQLite rewrites foreign keys and triggers during table renames. Moving
  // profiles first preserves legacy order links while account IDs stay intact
  // for sessions, purchases and audit records. The old link allowed all three
  // stores workflows, including when a profile's status was inactive.
  const statements = [
    ...(columns.size ? ['ALTER TABLE staff RENAME TO legacy_staff_profiles'] : []),
    'ALTER TABLE users RENAME TO staff',
    `ALTER TABLE staff ADD COLUMN ${PERMISSIONS_COLUMN}`,
    ...(columns.size ? [`UPDATE staff SET permissions = 7
      WHERE id IN (SELECT user_id FROM legacy_staff_profiles WHERE user_id IS NOT NULL)`] : [])
  ];
  try {
    await db.batch(statements.map(statement => db.prepare(statement)));
  } catch (error) {
    // A concurrent Worker isolate may already have committed the whole batch.
    if (!isAccountTable(await staffColumns(db))) throw error;
  }
}
