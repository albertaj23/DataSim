// Sandbox provisioner: DDL from the shared generator, applied by the admin connection, then deterministic seeding.
import type { Connection } from 'mysql2/promise';
import { Rng, generateDdl, makeGenerator, orderTables, q } from '@datasim/shared';
import type { Column, DesignDoc, GenFn, ProvisionProgressEvent, ProvisionResponse, Row, Table, ValueGenerator } from '@datasim/shared';
import { errnoOf, ER_DUP_ENTRY } from '../db/errors.js';
import { ServiceError } from '../services/liveStrategy.js';
import { adminConnect, sandboxName } from './admin.js';
import { hr, msSince } from './util.js';

export interface ProvisionOpts {
  rowScale?: number;
  seed?: number;
  runId?: string;
  onProgress?: (e: ProvisionProgressEvent) => void;
  isCancelled?: () => boolean;
}
export const BATCH_ROWS = 1000;

export class ProvisionCancelled extends Error { constructor() { super('cancelled'); this.name = 'ProvisionCancelled'; } }

const rowsFor = (t: Table, scale: number) => (t.seedRows === 0 ? 0 : Math.max(1, Math.round(t.seedRows * scale)));
const sqlMessage = (e: unknown) => (e as { sqlMessage?: string; message?: string }).sqlMessage ?? (e as Error).message;

/** Total rows that provisioning will insert for this design. */
export function totalSeedRows(design: DesignDoc, rowScale = 1): number {
  return design.schema.tables.reduce((s, t) => s + rowsFor(t, rowScale), 0);
}

// ---------------------------------------------------------------- default generator inference
function uniqueCols(t: Table): Set<string> {
  const s = new Set<string>();
  if (t.primaryKey.length === 1) s.add(t.primaryKey[0]!);
  t.uniques.filter((u) => u.columns.length === 1).forEach((u) => s.add(u.columns[0]!));
  t.indexes.filter((i) => i.unique && i.columns.length === 1).forEach((i) => s.add(i.columns[0]!));
  return s;
}

/** Inferred seed generator for a column that has no seed spec (brief 4.3). */
export function inferGenerator(c: Column, unique: boolean): ValueGenerator {
  const ty = c.type;
  switch (ty.kind) {
    case 'TINYINT': return unique ? { kind: 'sequence', start: 1, step: 1 } : { kind: 'uniformInt', min: 1, max: 100 };
    case 'SMALLINT': return unique ? { kind: 'sequence', start: 1, step: 1 } : { kind: 'uniformInt', min: 1, max: 1000 };
    case 'INT': case 'BIGINT': return unique ? { kind: 'sequence', start: 1, step: 1 } : { kind: 'uniformInt', min: 1, max: 1_000_000 };
    case 'DECIMAL': return { kind: 'decimalRange', min: 0, max: Math.min(10 ** (ty.precision - ty.scale) - 1, 1000), scale: ty.scale };
    case 'FLOAT': case 'DOUBLE': return { kind: 'decimalRange', min: 0, max: 1000, scale: 2 };
    case 'BOOLEAN': return { kind: 'pickList', values: [0, 1] };
    case 'CHAR': case 'VARCHAR': {
      const digits = Math.min(ty.length, unique ? 9 : 4);
      const prefix = ty.length > digits ? `${c.name.slice(0, Math.min(ty.length - digits, 6))}${ty.length - digits > 6 ? '_' : ''}` : '';
      return { kind: 'pattern', pattern: `${prefix}${'#'.repeat(digits)}`.slice(0, ty.length), mode: unique ? 'sequential' : 'random' };
    }
    case 'TEXT': return { kind: 'pattern', pattern: 'text-########', mode: unique ? 'sequential' : 'random' };
    case 'DATE': return { kind: 'dateRange', from: '2020-01-01', to: '2025-12-31' };
    case 'DATETIME': case 'TIMESTAMP': return { kind: 'dateRange', from: '2020-01-01 00:00:00', to: '2025-12-31 23:59:59' };
    case 'ENUM': return { kind: 'pickList', values: ty.values };
    case 'JSON': return { kind: 'constant', value: '{}' };
  }
}

interface ColumnPlan { name: string; gen: GenFn; late: boolean }

/** Maps a DDL/seed failure to a 400 that names the offending table. */
function tableError(code: string, what: string, table: string | null, err: unknown): ServiceError {
  const msg = sqlMessage(err);
  return new ServiceError(400, code, `${what}${table ? ` table ${table}` : ''}: ${msg}`, { table, details: { table, errno: errnoOf(err) ?? null, sqlMessage: msg } });
}
const tableOfStatement = (sql: string): string | null => sql.match(/^\s*(?:CREATE|ALTER) TABLE `([^`]+)`/i)?.[1] ?? null;

async function loadKeys(conn: Connection, table: string, cols: string[], cache: Map<string, Array<string | number>[]>): Promise<Array<string | number>[]> {
  const key = `${table}.${cols.join(',')}`;
  const hit = cache.get(key); if (hit) return hit;
  const [rows] = await conn.query({ sql: `SELECT ${cols.map(q).join(', ')} FROM ${q(table)} LIMIT 500000`, rowsAsArray: true });
  const out = rows as Array<string | number>[];
  cache.set(key, out);
  return out;
}

/** Builds one generator per column (autoIncrement/generated skipped). Exported for tests. */
export async function planTable(conn: Connection, t: Table, design: DesignDoc, seed: number, keyCache: Map<string, Array<string | number>[]>): Promise<ColumnPlan[]> {
  const uniq = uniqueCols(t);
  const plans: ColumnPlan[] = [];
  const colByName = new Map(t.columns.map((c) => [c.name, c]));
  const needsSeed = (c: Column) => !c.autoIncrement && !c.generated && (c.seed !== undefined || c.default === undefined || t.primaryKey.includes(c.name));

  // Composite FKs whose columns all lack a seed spec pick a whole parent tuple per row so the FK stays valid.
  const tupleCols = new Set<string>();
  for (const fk of t.foreignKeys) {
    if (fk.columns.length < 2) continue;
    const cols = fk.columns.map((n) => colByName.get(n)).filter((c): c is Column => !!c);
    if (cols.length !== fk.columns.length || !cols.every((c) => c.seed === undefined && needsSeed(c) && !tupleCols.has(c.name))) continue;
    const tuples = await loadKeys(conn, fk.refTable, fk.refColumns, keyCache);
    const rng = Rng.derive(seed, t.name, `fk:${fk.columns.join(',')}`);
    let lastI = -1; let cur: Array<string | number> = [];
    fk.columns.forEach((name, idx) => {
      tupleCols.add(name);
      plans.push({ name, late: false, gen: (i) => { if (i !== lastI) { lastI = i; cur = tuples[Math.floor(rng.float() * tuples.length)] ?? []; } return cur[idx] ?? null; } });
    });
  }

  for (const c of t.columns) {
    if (tupleCols.has(c.name) || !needsSeed(c)) continue;
    let spec = c.seed;
    if (!spec) {
      const fk = t.foreignKeys.find((f) => f.columns.length === 1 && f.columns[0] === c.name);
      spec = fk ? { kind: 'fkRef', table: fk.refTable, column: fk.refColumns[0]!, dist: 'uniform', s: 1.1 } : inferGenerator(c, uniq.has(c.name));
    }
    let keys: Array<string | number> | undefined;
    if (spec.kind === 'fkRef') {
      if (!design.schema.tables.some((x) => x.name === spec!.table)) throw new ServiceError(400, 'SEED_SPEC', `Seed generator of ${t.name}.${c.name} references unknown table ${spec.table}`, { table: t.name, details: { table: t.name, column: c.name } });
      keys = (await loadKeys(conn, spec.table, [spec.column], keyCache)).map((r) => r[0]!);
    }
    plans.push({ name: c.name, late: spec.kind === 'expression' || spec.kind === 'email', gen: makeGenerator(spec, { rng: Rng.derive(seed, t.name, c.name), keys }) });
  }
  return plans;
}

/** Applies DDL + seeds data into the project's sandbox database (drop + create). */
export async function provision(projectId: string, design: DesignDoc, opts: ProvisionOpts = {}): Promise<ProvisionResponse> {
  const t0 = hr();
  const database = sandboxName(projectId);
  const scale = opts.rowScale ?? 1;
  const seed = opts.seed ?? design.seed;
  const conn = await adminConnect();
  try {
    await conn.query(`DROP DATABASE IF EXISTS ${q(database)}`);
    await conn.query(`CREATE DATABASE ${q(database)} CHARACTER SET utf8mb4`);
    await conn.query(`USE ${q(database)}`);

    for (const stmt of generateDdl(design.schema).statements) {
      try { await conn.query(stmt); } catch (err) { throw tableError('DDL_ERROR', 'Cannot create', tableOfStatement(stmt), err); }
    }

    const { ordered } = orderTables(design.schema);
    const allRows = ordered.reduce((s, t) => s + rowsFor(t, scale), 0);
    const keyCache = new Map<string, Array<string | number>[]>();
    let done = 0;
    for (const t of ordered) {
      const n = rowsFor(t, scale);
      if (n === 0) continue;
      const plans = await planTable(conn, t, design, seed, keyCache);
      const insertCols = plans.map((p) => p.name);
      const order = [...plans.filter((p) => !p.late), ...plans.filter((p) => p.late)];
      const index = new Map(insertCols.map((c, i) => [c, i]));
      const sqlHead = `INSERT INTO ${q(t.name)} (${insertCols.map(q).join(', ')}) VALUES ?`;
      await conn.query('START TRANSACTION');
      try {
        for (let start = 0; start < n; start += BATCH_ROWS) {
          if (opts.isCancelled?.()) throw new ProvisionCancelled();
          const end = Math.min(n, start + BATCH_ROWS);
          const batch: unknown[][] = new Array(end - start);
          const row: Row = {};
          for (let i = start; i < end; i++) {
            const out = new Array(insertCols.length);
            for (const p of order) { const v = p.gen(i, row); row[p.name] = v; out[index.get(p.name)!] = v; }
            batch[i - start] = out;
          }
          try {
            await conn.query(sqlHead, [batch]);
          } catch (err) {
            if (errnoOf(err) !== ER_DUP_ENTRY) throw err;
            // Random draws over a composite key can collide; keep the first row for each key (row count then ends below target).
            await conn.query(sqlHead.replace('INSERT', 'INSERT IGNORE'), [batch]);
          }
          done += end - start;
          opts.onProgress?.({ runId: opts.runId ?? projectId, table: t.name, rows: end, totalRows: n, doneRows: done, allRows });
        }
        await conn.query('COMMIT');
      } catch (err) {
        await conn.query('ROLLBACK').catch(() => undefined);
        if (err instanceof ProvisionCancelled || err instanceof ServiceError) throw err;
        throw tableError('SEED_ERROR', 'Seeding failed for', t.name, err);
      }
    }
    for (const t of ordered) await conn.query(`ANALYZE TABLE ${q(t.name)}`);
    return { database, tables: ordered.length, rows: done, ms: Math.round(msSince(t0)) };
  } finally {
    await conn.end().catch(() => undefined);
  }
}
