import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

/**
 * Every committed state change bumps account.state_version (PLAN.md §2 item 11).
 * LAST_INSERT_ID(expr) stores the new value per connection, so we can read it back without a
 * second locking read. Must run AFTER any INSERT in the same transaction, because an
 * AUTO_INCREMENT insert overwrites LAST_INSERT_ID().
 */
export async function bumpVersion(conn: PoolConnection, accountId: number): Promise<number> {
  await conn.query(
    'UPDATE account SET state_version = LAST_INSERT_ID(state_version + 1) WHERE account_id = ?',
    [accountId],
  );
  const [rows] = await conn.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS v');
  return Number(rows[0]!.v);
}
