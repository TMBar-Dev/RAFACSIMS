export function networkKey(address) {
  if (!address) return 'unknown';
  if (!address.includes(':')) return address;
  try {
    // Canonicalize compressed IPv6 before grouping by network prefix.
    const host = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const [left, right] = host.split('::');
    const leading = left ? left.split(':') : [];
    const trailing = right ? right.split(':') : [];
    const groups = right === undefined ? leading
      : [...leading, ...Array(8 - leading.length - trailing.length).fill('0'), ...trailing];
    if (groups.slice(0, 5).every(group => group === '0') && groups[5] === 'ffff') {
      const mapped = parseInt(groups[6] + groups[7].padStart(4, '0'), 16);
      return [24, 16, 8, 0].map(shift => (mapped >>> shift) & 255).join('.');
    }
    return groups.slice(0, 4).join(':') + '::/64';
  } catch {
    return 'unknown';
  }
}

export function loginLimits(db, keys, now) {
  const [network, account] = keys;
  return {
    async reserve() {
      // Reserve both slots atomically before hashing so parallel requests
      // cannot all pass the check against the same remaining attempt.
      const [reserved, blocked] = await db.batch([
        db.prepare(`INSERT INTO rate_limits (bucket, hits, expires_at)
          SELECT candidate.bucket, 1, candidate.expiry FROM (
            SELECT ? AS bucket, ? AS expiry UNION ALL SELECT ?, ?
          ) candidate WHERE NOT EXISTS (
            SELECT 1 FROM rate_limits WHERE expires_at > ?
              AND ((bucket = ? AND hits >= 120) OR (bucket = ? AND hits >= 8))
          )
          ON CONFLICT(bucket) DO UPDATE SET
            hits = CASE WHEN expires_at <= ? THEN 1 ELSE hits + 1 END,
            expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
          RETURNING bucket, expires_at`).bind(network, now + 120, account, now + 300, now, network, account, now, now),
        db.prepare(`SELECT max(expires_at - ?) AS seconds FROM rate_limits WHERE expires_at > ?
          AND ((bucket = ? AND hits >= 120) OR (bucket = ? AND hits >= 8))`).bind(now, now, network, account),
        db.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(now)
      ]);
      const slot = reserved.results.find(row => row.bucket === network);
      return slot ? { expiresAt: slot.expires_at } : { retryAfter: blocked.results[0]?.seconds ?? 1 };
    },
    async succeeded(expiresAt) {
      await db.batch([
        db.prepare('DELETE FROM rate_limits WHERE bucket = ?').bind(account),
        db.prepare('UPDATE rate_limits SET hits = max(0, hits - 1) WHERE bucket = ? AND expires_at = ?')
          .bind(network, expiresAt)
      ]);
    }
  };
}
