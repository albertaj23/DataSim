import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { dbConnectionOptions } from '../db/pool.js';
import { appPool } from '../db/pool.js';

/** `dsim_<first 8 hex of projectId>`. */
export const sandboxName = (projectId: string): string => `dsim_${projectId.replace(/[^0-9a-fA-F]/g, '').toLowerCase().slice(0, 8).padEnd(8, '0')}`;

/** Dedicated admin (root) connection, optionally scoped to a database. Caller closes it. */
export async function adminConnect(database?: string): Promise<Connection> {
  return mysql.createConnection({ ...dbConnectionOptions, database, multipleStatements: false, namedPlaceholders: false });
}

export async function withAdmin<T>(database: string | undefined, fn: (c: Connection) => Promise<T>): Promise<T> {
  const c = await adminConnect(database);
  try { return await fn(c); } finally { await c.end().catch(() => undefined); }
}

export async function sandboxExists(database: string): Promise<boolean> {
  const [rows] = await appPool.query<RowDataPacket[]>('SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
  return rows.length > 0;
}

export async function mysqlVersion(): Promise<string> {
  const [rows] = await appPool.query<RowDataPacket[]>('SELECT VERSION() AS v');
  return String(rows[0]?.v ?? '');
}
