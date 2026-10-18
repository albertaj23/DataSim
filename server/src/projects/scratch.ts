import { randomBytes } from 'node:crypto';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { generateDdl, hasErrors, validateDesign } from '@datasim/shared';
import type { DesignDoc, Problem, SchemaModel } from '@datasim/shared';
import { dbConnectionOptions } from '../db/pool.js';
import { appPool } from '../db/pool.js';

const SCRATCH_PREFIX = 'dsim_scratch_';
const qi = (s: string) => `\`${s.replace(/`/g, '``')}\``;

/** Runs `fn` on an admin connection `USE`-ing a fresh scratch schema; the schema is always dropped afterwards. */
export async function withScratchSchema<T>(projectId: string, fn: (conn: Connection, database: string) => Promise<T>): Promise<T> {
  const database = `${SCRATCH_PREFIX}${projectId.replace(/-/g, '').slice(0, 8)}_${randomBytes(3).toString('hex')}`;
  const conn = await mysql.createConnection({ ...dbConnectionOptions, database: undefined });
  try {
    await conn.query(`CREATE DATABASE ${qi(database)} DEFAULT CHARACTER SET utf8mb4`);
    await conn.query(`USE ${qi(database)}`);
    return await fn(conn, database);
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${qi(database)}`).catch(() => undefined);
    await conn.end().catch(() => undefined);
  }
}

/** Drops scratch schemas left by a crashed process. Called at startup. */
export async function dropStaleScratchSchemas(): Promise<void> {
  const [rows] = await appPool.query<RowDataPacket[]>('SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?', [`${SCRATCH_PREFIX.replace(/_/g, '\\_')}%`]);
  for (const r of rows) await appPool.query(`DROP DATABASE IF EXISTS ${qi(r.n)}`);
}

const tableOf = (sql: string) => /^\s*(?:CREATE TABLE|ALTER TABLE)\s+`([^`]+)`/i.exec(sql)?.[1];
const errText = (e: unknown) => ((e as { sqlMessage?: string }).sqlMessage ?? (e as Error).message);

/** Applies the design's generated DDL (as admin) to the scratch schema; one problem per failing statement, mapped to its table. */
export async function applySchemaDdl(conn: Connection, schema: SchemaModel): Promise<Problem[]> {
  const out: Problem[] = [];
  for (const stmt of generateDdl(schema).statements) {
    try { await conn.query(stmt); } catch (e) {
      const table = tableOf(stmt);
      out.push({ severity: 'error', code: `DDL_${(e as { errno?: number }).errno ?? 'ERR'}`, message: `MySQL rejected ${table ? `table ${table}` : 'a statement'}: ${errText(e)}`, path: table ? { table } : {} });
    }
  }
  return out;
}

/** Replaces `:param` / `:$bind.col` with `?` outside string literals so MySQL can PREPARE the statement. */
export function toPreparable(sql: string): string {
  return sql.replace(/('(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"|`[^`]*`)|(?<!:):(?:\$[A-Za-z_]\w*\.\w+|[A-Za-z_]\w*)/g, (m, lit) => (lit ? m : '?'));
}

/** Static checks (shared) plus MySQL-backed checks: DDL applies in a scratch schema, workload SQL and invariants PREPARE against it. */
export async function validateDesignFull(projectId: string, design: DesignDoc): Promise<Problem[]> {
  const problems = validateDesign(design);
  if (design.schema.tables.length === 0) return problems;
  // Structural errors (unknown columns etc.) would only yield noisier MySQL errors for the same cause.
  if (hasErrors(problems.filter((p) => p.path.table))) return problems;
  const db = await withScratchSchema(projectId, async (conn) => {
    const ddl = await applySchemaDdl(conn, design.schema);
    const sqlProblems: Problem[] = [];
    if (ddl.length === 0) {
      const tryPrepare = async (sql: string, path: Problem['path'], what: string) => {
        try { const ps = await conn.prepare(toPreparable(sql)); ps.close(); } catch (e) {
          sqlProblems.push({ severity: 'error', code: 'SQL_PREPARE', message: `${what}: ${errText(e)}`, path });
        }
      };
      for (const t of design.workload.transactions) {
        for (const [variant, steps] of Object.entries(t.variants)) {
          for (let i = 0; i < steps.length; i++) await tryPrepare(steps[i]!.sql, { txn: t.name, variant, step: i }, `${t.name}/${variant} step ${i + 1}`);
        }
      }
      for (const inv of design.workload.invariants) await tryPrepare(inv.sql, { invariant: inv.name }, `Invariant ${inv.name}`);
    }
    return [...ddl, ...sqlProblems];
  });
  return [...problems, ...db];
}
