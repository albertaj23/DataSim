// Sandbox operations used by the Studio editors: provision, "Test once" and the read-only SQL console.
import mysql from 'mysql2/promise';
import type { Connection } from 'mysql2/promise';
import { Rng, makeGenerator, strategyFor } from '@datasim/shared';
import type { DesignDoc, ProvisionResponse, QueryResponse, TestTxnBody, TestTxnResponse, Transaction } from '@datasim/shared';
import { config } from '../config.js';
import { ServiceError } from '../services/liveStrategy.js';
import { getActiveRunId } from './active.js';
import { sandboxExists, sandboxName, withAdmin } from './admin.js';
import { TxnReject, assertSafeStatement, compileStep, execSteps } from './exec.js';
import type { Params } from './exec.js';
import { provision } from './provision.js';
import type { ProvisionOpts } from './provision.js';
import { hr, msSince } from './util.js';

const sqlMessage = (e: unknown) => (e as { sqlMessage?: string }).sqlMessage ?? (e as Error).message;

export async function provisionSandbox(projectId: string, design: DesignDoc, opts: ProvisionOpts = {}): Promise<ProvisionResponse> {
  if (getActiveRunId()) throw new ServiceError(409, 'RUN_ACTIVE', 'A run is in progress; provisioning would drop its sandbox. Wait for it to finish or cancel it.', { activeRunId: getActiveRunId() });
  return provision(projectId, design, opts);
}

/** Connection as the restricted workload user, scoped to the sandbox database. */
async function runnerConnect(database: string): Promise<Connection> {
  return mysql.createConnection({ host: config.DB_HOST, port: config.DB_PORT, user: config.RUNNER_USER, password: config.RUNNER_PASSWORD, database, supportBigNumbers: true, timezone: 'Z', namedPlaceholders: false });
}

async function requireSandbox(projectId: string): Promise<string> {
  const database = sandboxName(projectId);
  if (!(await sandboxExists(database))) throw new ServiceError(400, 'NOT_PROVISIONED', 'The sandbox is not provisioned yet. Provision it first (Schema Designer: Seed data, or run a test).');
  return database;
}

async function sampleParams(database: string, txn: Transaction, seed: number): Promise<Params> {
  const out: Params = {};
  await withAdmin(database, async (admin) => {
    for (const [name, spec] of Object.entries(txn.params)) {
      let keys: Array<string | number> | undefined;
      if (spec.kind === 'fromTable' || spec.kind === 'fkRef') {
        const [rows] = await admin.query({ sql: `SELECT \`${spec.column}\` FROM \`${spec.table}\` ORDER BY \`${spec.column}\` LIMIT 100000`, rowsAsArray: true });
        keys = (rows as Array<[string | number]>).map((r) => r[0]);
      }
      out[name] = makeGenerator(spec, { rng: Rng.derive(seed, 'test', txn.name, name), keys })(0, {}) as never;
    }
  });
  return out;
}

const ROW_PREVIEW = 20;
const ISO_SQL = (iso: string) => iso.replace(/ /g, '-');

/** Runs one instance of a transaction on the sandbox inside a transaction, then ROLLBACK. Reports rows / affected / ms per step. */
export async function testTransaction(projectId: string, design: DesignDoc, body: TestTxnBody): Promise<TestTxnResponse> {
  const database = await requireSandbox(projectId);
  const txn = design.workload.transactions.find((t) => t.name === body.txnName);
  if (!txn) throw new ServiceError(404, 'NOT_FOUND', `Unknown transaction ${body.txnName}`);
  const appStrategy = design.nodes.find((n) => n.type === 'app');
  const variant = strategyFor(txn, body.variant ?? (appStrategy?.type === 'app' ? appStrategy.config.strategy : 'default'));
  const steps = txn.variants[variant as keyof typeof txn.variants] ?? txn.variants.default!;
  let compiled;
  try { compiled = steps.map(compileStep); } catch (e) { throw new ServiceError(400, 'BAD_SQL', (e as Error).message); }
  const params = await sampleParams(database, txn, design.seed);
  const mysqlNode = design.nodes.find((n) => n.type === 'mysql');
  const cfg = mysqlNode?.type === 'mysql' ? mysqlNode.config : { isolation: 'REPEATABLE READ' as const, lockWaitTimeoutS: 3, maxExecutionTimeMs: 0 };
  const iso = variant === 'serializable' ? 'SERIALIZABLE' : cfg.isolation;

  const conn = await runnerConnect(database);
  const res: TestTxnResponse = { txnName: txn.name, variant, params, outcome: 'COMMITTED_THEN_ROLLED_BACK', steps: [] };
  try {
    await conn.query(`SET SESSION innodb_lock_wait_timeout = ${Math.round(cfg.lockWaitTimeoutS)}, transaction_isolation = '${ISO_SQL(iso)}', max_execution_time = ${Math.round(cfg.maxExecutionTimeMs)}`);
    await conn.query(txn.readOnly ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION');
    try {
      await execSteps(conn as never, compiled, params, {
        after: (i) => { res.steps.push({ index: i.index, sql: i.sql, rows: i.rows.slice(0, ROW_PREVIEW), rowCount: i.rowCount, affected: i.affected, ms: Math.round(i.ms * 1000) / 1000, ...(i.guard ? { guard: i.guard } : {}) }); },
        onError: (idx, err, ms) => { res.steps.push({ index: idx, sql: steps[idx]!.sql, rows: [], rowCount: 0, affected: null, ms: Math.round(ms * 1000) / 1000, error: sqlMessage(err) }); },
      });
    } catch (err) {
      if (err instanceof TxnReject) { res.outcome = 'REJECTED'; res.message = err.message; } else { res.outcome = 'ERROR'; res.message = sqlMessage(err); }
    }
  } finally {
    await conn.query('ROLLBACK').catch(() => undefined);
    await conn.end().catch(() => undefined);
  }
  return res;
}

const QUERY_START = /^\s*(select|with)\b/i;
const EXPLAIN_START = /^\s*explain\s+(?:format\s*=\s*(?:json|tree|traditional)\s+)?(select|with)\b/i;
export const QUERY_ROW_CAP = 200;

/** Read-only SELECT console on the sandbox: restricted user, READ ONLY transaction, 200-row cap, 5 s execution limit. */
export async function sandboxQuery(projectId: string, sql: string): Promise<QueryResponse> {
  const database = await requireSandbox(projectId);
  const isExplain = EXPLAIN_START.test(sql);
  if (!isExplain && !QUERY_START.test(sql)) throw new ServiceError(400, 'BAD_SQL', 'Only SELECT (or EXPLAIN SELECT) statements are allowed in the console');
  try { assertSafeStatement(isExplain ? sql.replace(/^\s*explain\s+(?:format\s*=\s*\w+\s+)?/i, '') : sql); } catch (e) { throw new ServiceError(400, 'BAD_SQL', (e as Error).message); }
  if (/\b(into\s+(outfile|dumpfile)|for\s+update|lock\s+in\s+share\s+mode)\b/i.test(sql)) throw new ServiceError(400, 'BAD_SQL', 'Locking reads and INTO OUTFILE are not allowed in the console');
  const conn = await runnerConnect(database);
  try {
    await conn.query(`SET SESSION sql_select_limit = ${QUERY_ROW_CAP + 1}, max_execution_time = 5000`);
    await conn.query('START TRANSACTION READ ONLY');
    const t0 = hr();
    let rows: unknown[][]; let fields: Array<{ name: string }>;
    try {
      const [r, f] = await conn.query({ sql, rowsAsArray: true });
      rows = r as unknown[][]; fields = (f ?? []) as Array<{ name: string }>;
    } catch (e) { throw new ServiceError(400, 'QUERY_ERROR', sqlMessage(e)); }
    const ms = Math.round(msSince(t0) * 100) / 100;
    return { columns: fields.map((x) => x.name), rows: rows.slice(0, QUERY_ROW_CAP), truncated: rows.length > QUERY_ROW_CAP, ms };
  } finally {
    await conn.query('ROLLBACK').catch(() => undefined);
    await conn.end().catch(() => undefined);
  }
}

