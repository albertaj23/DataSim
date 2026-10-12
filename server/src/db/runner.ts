import mysql, { type Pool, type PoolOptions, type RowDataPacket } from 'mysql2/promise';
import { config } from '../config.js';
import { appPool } from './pool.js';

const RUNNER_HOST = '%';
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;

/**
 * Idempotently creates the restricted user that executes workload SQL.
 * It can only touch sandbox schemas (dsim_*): no DDL, no access to the `datasim` meta database.
 */
export async function ensureRunnerUser(): Promise<void> {
  const account = `${q(config.RUNNER_USER)}@${q(RUNNER_HOST)}`;
  await appPool.query(`CREATE USER IF NOT EXISTS ${account} IDENTIFIED BY ${q(config.RUNNER_PASSWORD)}`);
  await appPool.query(`ALTER USER ${account} IDENTIFIED BY ${q(config.RUNNER_PASSWORD)}`);
  await appPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`dsim\\_%\`.* TO ${account}`);
}

/** Pool options for a sandbox database as the restricted user. Engine builds one pool per app instance from these. */
export function runnerPoolOptions(database: string, connectionLimit: number): PoolOptions {
  return {
    host: config.DB_HOST, port: config.DB_PORT, user: config.RUNNER_USER, password: config.RUNNER_PASSWORD,
    database, connectionLimit, waitForConnections: true, queueLimit: 0,
    supportBigNumbers: true, bigNumberStrings: false, timezone: 'Z', namedPlaceholders: true,
  };
}
export const createRunnerPool = (database: string, connectionLimit: number): Pool => mysql.createPool(runnerPoolOptions(database, connectionLimit));

/** True if the restricted user can log in (used by /api/health and `npm run doctor`). */
export async function runnerOk(): Promise<{ ok: boolean; error?: string }> {
  try {
    const conn = await mysql.createConnection({ host: config.DB_HOST, port: config.DB_PORT, user: config.RUNNER_USER, password: config.RUNNER_PASSWORD });
    const [rows] = await conn.query<RowDataPacket[]>('SELECT CURRENT_USER() AS u');
    await conn.end();
    return { ok: !!rows[0] };
  } catch (err) { return { ok: false, error: (err as Error).message }; }
}
