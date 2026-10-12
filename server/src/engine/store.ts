// Relational persistence of runs (005 migration tables) and report reconstruction.
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DesignDoc } from '@datasim/shared';
import type {
  Bottleneck, CapacityFit, CapacityPoint, CapacityResult, Finding, FindingFix, InvariantResult, LockWaitRow, RunKind, RunListQuery, RunReport, RunSample, RunStatus, RunSummary, SloVerdict, StatementStat, TxnStat,
} from '@datasim/shared';
import { appPool } from '../db/pool.js';

const iso = (d: Date | string | null): string | null => (d === null ? null : (d instanceof Date ? d : new Date(d)).toISOString());
const json = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);
const fin = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : v);
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export interface NewRun {
  runId: string; projectId: string; revisionNo: number; kind: RunKind; parentRunId?: string | null;
  settings: Record<string, unknown>; strategy: string; isolation: string; vus: number; durationS: number; seed: number;
}
export async function createRunRow(r: NewRun): Promise<void> {
  await appPool.query(
    `INSERT INTO run (run_id, project_id, revision_no, kind, parent_run_id, status, settings_json, strategy, isolation_level, vus, duration_s, seed)
     VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?)`,
    [r.runId, r.projectId, r.revisionNo, r.kind, r.parentRunId ?? null, JSON.stringify(r.settings), r.strategy.slice(0, 24), r.isolation, r.vus, Math.round(r.durationS), r.seed]);
}

export async function setRunStatus(runId: string, status: RunStatus, extra: { startedAt?: boolean; mysqlVersion?: string } = {}): Promise<void> {
  await appPool.query(
    `UPDATE run SET status = ?, started_at = IF(? AND started_at IS NULL, NOW(3), started_at), mysql_version = COALESCE(?, mysql_version) WHERE run_id = ?`,
    [status, extra.startedAt ? 1 : 0, extra.mysqlVersion ?? null, runId]);
}

export async function failRun(runId: string, status: 'FAILED' | 'CANCELLED', message: string | null): Promise<void> {
  await appPool.query(`UPDATE run SET status = ?, error_text = ?, finished_at = NOW(3) WHERE run_id = ?`, [status, message ? message.slice(0, 1000) : null, runId]);
}

export interface FinalRun {
  runId: string;
  settings: Record<string, unknown>;
  totals: { count: number; committed: number; rejected: number; errored: number; retries: number; deadlocks: number; lockTimeouts: number; tpsAvg: number; p50Ms: number; p95Ms: number; p99Ms: number };
  cacheHitRatio: number | null;
  slo: SloVerdict | null;
  bottleneck: Bottleneck | null;
  samples: RunSample[];
  txnStats: TxnStat[];
  statements: StatementStat[];
  lockWaits: LockWaitRow[];
  invariants: InvariantResult[];
  findings: Finding[];
  capacity?: { points: CapacityPoint[]; fit: CapacityFit | null; kneeVus: number | null; sustainedVus: number | null; sentence: string };
  status: 'COMPLETED' | 'CANCELLED';
}

const chunks = <T>(list: T[], size: number): T[][] => { const out: T[][] = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };

export async function persistFinal(f: FinalRun): Promise<void> {
  const c: PoolConnection = await appPool.getConnection();
  try {
    await c.query('START TRANSACTION');
    await c.query(
      `UPDATE run SET status = ?, finished_at = NOW(3), settings_json = ?, txn_total = ?, committed = ?, rejected = ?, errored = ?, retries = ?, deadlocks = ?, lock_timeouts = ?,
         tps_avg = ?, p50_ms = ?, p95_ms = ?, p99_ms = ?, cache_hit_ratio = ?, slo_pass = ?, slo_reasons_json = ?, bottleneck_json = ? WHERE run_id = ?`,
      [f.status, JSON.stringify(f.settings), f.totals.count, f.totals.committed, f.totals.rejected, f.totals.errored, f.totals.retries, f.totals.deadlocks, f.totals.lockTimeouts,
        f.totals.tpsAvg, f.totals.p50Ms, f.totals.p95Ms, f.totals.p99Ms, fin(f.cacheHitRatio), f.slo ? (f.slo.pass ? 1 : 0) : null, f.slo ? JSON.stringify(f.slo.reasons) : null, f.bottleneck ? JSON.stringify(f.bottleneck) : null, f.runId]);
    for (const part of chunks(f.samples, 500)) {
      await c.query(
        `INSERT INTO run_sample (run_id, t_s, tps, p50_ms, p95_ms, p99_ms, errors, active_vus, app_queue, pool_waiting, threads_running, row_lock_waits, lock_wait_ms, bp_hit_ratio, cache_hit_ratio, retries, deadlocks) VALUES ?`,
        [part.map((s) => [f.runId, Math.max(0, Math.round(s.tS)), s.tps, s.p50Ms, s.p95Ms, s.p99Ms, s.errors, s.activeVus, s.appQueue, s.poolWaiting, s.threadsRunning, s.rowLockWaits, s.lockWaitMs, fin(s.bpHitRatio), fin(s.cacheHitRatio), s.retries ?? 0, s.deadlocks ?? 0])]);
    }
    if (f.txnStats.length) {
      await c.query(
        `INSERT INTO run_txn_stat (run_id, txn_name, \`count\`, committed, rejected, errored, retries, deadlocks, p50_ms, p95_ms, p99_ms, mean_ms, queue_ms, net_ms, app_ms, pool_ms, db_ms) VALUES ?`,
        [f.txnStats.map((t) => [f.runId, t.txnName, t.count, t.committed, t.rejected, t.errored, t.retries, t.deadlocks, t.p50Ms, t.p95Ms, t.p99Ms, t.meanMs, t.queueMs, t.netMs, t.appMs, t.poolMs, t.dbMs])]);
    }
    for (const part of chunks(f.statements, 100)) {
      await c.query(
        `INSERT INTO run_statement_stat (run_id, digest, digest_text, txn_name, exec_count, avg_ms, max_ms, rows_examined, rows_sent, rows_affected, no_index_used, lock_time_ms, explain_json) VALUES ?`,
        [part.map((s) => [f.runId, s.digest, s.digestText, s.txnName, s.execCount, s.avgMs, s.maxMs, Math.max(0, s.rowsExamined), Math.max(0, s.rowsSent), Math.max(0, s.rowsAffected), Math.max(0, s.noIndexUsed), s.lockTimeMs, s.explain === null ? null : JSON.stringify(s.explain)])]);
    }
    for (const part of chunks(f.lockWaits, 200)) {
      await c.query(
        `INSERT INTO run_lock_wait (run_id, seq, at_ms, waiting_txn, blocking_txn, table_name, index_name, lock_mode, lock_data) VALUES ?`,
        [part.map((l) => [f.runId, l.seq, l.atMs, l.waitingTxn.slice(0, 64), l.blockingTxn.slice(0, 64), l.tableName.slice(0, 64), l.indexName, l.lockMode.slice(0, 32), l.lockData ? l.lockData.slice(0, 255) : null])]);
    }
    if (f.invariants.length) {
      await c.query(
        `INSERT INTO run_invariant (run_id, invariant_name, description, sql_text, violations, passed, error_text) VALUES ?`,
        [f.invariants.map((i) => [f.runId, i.name, (i.description ?? '').slice(0, 500), i.sql, i.violations, i.passed ? 1 : 0, i.error ? i.error.slice(0, 500) : null])]);
    }
    if (f.findings.length) {
      await c.query(
        `INSERT INTO run_finding (run_id, finding_no, severity, kind, title, explanation, evidence_json, fix_json, fix_label) VALUES ?`,
        [f.findings.map((x) => [f.runId, x.findingNo, x.severity, x.kind, x.title.slice(0, 200), x.explanation, JSON.stringify(x.evidence ?? {}), x.fix ? JSON.stringify(x.fix) : null, x.fixLabel ? x.fixLabel.slice(0, 120) : null])]);
    }
    if (f.capacity) {
      if (f.capacity.points.length) {
        await c.query(
          `INSERT INTO capacity_point (run_id, step_no, vus, tps, p50_ms, p95_ms, error_rate) VALUES ?`,
          [f.capacity.points.map((p) => [f.runId, p.stepNo, p.vus, p.tps, p.p50Ms, p.p95Ms, p.errorRate])]);
      }
      const fit = f.capacity.fit;
      await c.query(
        `INSERT INTO capacity_fit (run_id, sigma, kappa, lambda_, n_peak, x_max, r2, knee_vus, sustained_vus, sentence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [f.runId, fit?.sigma ?? 0, fit?.kappa ?? 0, fit?.lambda ?? 0, fit?.nPeak ?? 0, fit?.xMax ?? 0, fit?.r2 ?? 0, f.capacity.kneeVus === null ? null : Math.round(f.capacity.kneeVus), f.capacity.sustainedVus === null ? null : Math.round(f.capacity.sustainedVus), f.capacity.sentence.slice(0, 500)]);
    }
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

// ---------------------------------------------------------------- reading
const SUMMARY_SELECT = `
  SELECT r.*, p.name AS project_name,
         COALESCE((SELECT SUM(i.violations) FROM run_invariant i WHERE i.run_id = r.run_id), 0) AS inv_violations
    FROM run r JOIN project p ON p.project_id = r.project_id`;

function toSummary(r: RowDataPacket): RunSummary {
  return {
    runId: r.run_id, projectId: r.project_id, projectName: r.project_name, revisionNo: r.revision_no, kind: r.kind, status: r.status, parentRunId: r.parent_run_id ?? null,
    strategy: r.strategy, isolation: r.isolation_level, vus: r.vus, durationS: r.duration_s, seed: r.seed, mysqlVersion: r.mysql_version ?? null,
    startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), txnTotal: r.txn_total, committed: r.committed, rejected: r.rejected, errored: r.errored, retries: r.retries,
    deadlocks: r.deadlocks, lockTimeouts: r.lock_timeouts, tpsAvg: num(r.tps_avg), p50Ms: num(r.p50_ms), p95Ms: num(r.p95_ms), p99Ms: num(r.p99_ms),
    sloPass: r.slo_pass === null ? null : !!r.slo_pass, errorText: r.error_text ?? null, invariantViolations: num(r.inv_violations),
  };
}

export async function loadSummary(runId: string): Promise<RunSummary | null> {
  const [rows] = await appPool.query<RowDataPacket[]>(`${SUMMARY_SELECT} WHERE r.run_id = ?`, [runId]);
  return rows[0] ? toSummary(rows[0]) : null;
}

export async function listRuns(q: RunListQuery = {}): Promise<RunSummary[]> {
  const where: string[] = []; const vals: unknown[] = [];
  if (q.projectId) { where.push('r.project_id = ?'); vals.push(q.projectId); }
  if (q.kind) { where.push('r.kind = ?'); vals.push(q.kind); }
  if (q.verdict) { where.push('r.slo_pass = ?'); vals.push(q.verdict === 'pass' ? 1 : 0); }
  const [rows] = await appPool.query<RowDataPacket[]>(`${SUMMARY_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at DESC LIMIT 200`, vals);
  return rows.map(toSummary);
}

export async function loadReport(runId: string): Promise<RunReport | null> {
  const [rows] = await appPool.query<RowDataPacket[]>(`${SUMMARY_SELECT} WHERE r.run_id = ?`, [runId]);
  const row = rows[0]; if (!row) return null;
  const run = toSummary(row);
  const [rev] = await appPool.query<RowDataPacket[]>('SELECT design_json FROM design_revision WHERE project_id = ? AND revision_no = ?', [run.projectId, run.revisionNo]);
  const design = DesignDoc.parse(rev[0] ? json(rev[0].design_json) : {});
  const [samples] = await appPool.query<RowDataPacket[]>('SELECT * FROM run_sample WHERE run_id = ? ORDER BY t_s', [runId]);
  const [txn] = await appPool.query<RowDataPacket[]>('SELECT * FROM run_txn_stat WHERE run_id = ? ORDER BY txn_name', [runId]);
  const [stm] = await appPool.query<RowDataPacket[]>('SELECT * FROM run_statement_stat WHERE run_id = ? ORDER BY avg_ms * exec_count DESC', [runId]);
  const [locks] = await appPool.query<RowDataPacket[]>('SELECT * FROM run_lock_wait WHERE run_id = ? ORDER BY seq', [runId]);
  const [inv] = await appPool.query<RowDataPacket[]>('SELECT * FROM run_invariant WHERE run_id = ? ORDER BY invariant_name', [runId]);
  const [fnd] = await appPool.query<RowDataPacket[]>('SELECT * FROM run_finding WHERE run_id = ? ORDER BY finding_no', [runId]);
  const [pts] = await appPool.query<RowDataPacket[]>('SELECT * FROM capacity_point WHERE run_id = ? ORDER BY step_no', [runId]);
  const [fit] = await appPool.query<RowDataPacket[]>('SELECT * FROM capacity_fit WHERE run_id = ?', [runId]);

  let capacity: CapacityResult | null = null;
  if (pts.length || fit[0]) {
    const f = fit[0];
    const hasFit = !!f && num(f.lambda_) > 0;
    capacity = {
      points: pts.map((p): CapacityPoint => ({ stepNo: p.step_no, vus: p.vus, tps: num(p.tps), p50Ms: num(p.p50_ms), p95Ms: num(p.p95_ms), errorRate: num(p.error_rate), runId })),
      fit: hasFit ? { sigma: f!.sigma, kappa: f!.kappa, lambda: f!.lambda_, nPeak: num(f!.n_peak) > 0 ? num(f!.n_peak) : null, xMax: num(f!.x_max) > 0 ? num(f!.x_max) : null, r2: f!.r2 } : null,
      kneeVus: f?.knee_vus ?? null, sustainedVus: f?.sustained_vus ?? null, sentence: f?.sentence ?? '',
    };
  }
  const reasons = row.slo_reasons_json ? (json(row.slo_reasons_json) as string[]) : [];
  return {
    run, settings: (json(row.settings_json) as Record<string, unknown>) ?? {}, design,
    samples: samples.map((s): RunSample => ({
      tS: s.t_s, tps: num(s.tps), p50Ms: num(s.p50_ms), p95Ms: num(s.p95_ms), p99Ms: num(s.p99_ms), errors: s.errors, activeVus: s.active_vus, appQueue: s.app_queue, poolWaiting: s.pool_waiting,
      threadsRunning: s.threads_running, rowLockWaits: s.row_lock_waits, lockWaitMs: num(s.lock_wait_ms), bpHitRatio: s.bp_hit_ratio === null ? null : num(s.bp_hit_ratio),
      cacheHitRatio: s.cache_hit_ratio === null ? null : num(s.cache_hit_ratio), retries: s.retries, deadlocks: s.deadlocks,
    })),
    txnStats: txn.map((t): TxnStat => ({
      txnName: t.txn_name, count: t.count, committed: t.committed, rejected: t.rejected, errored: t.errored, retries: t.retries, deadlocks: t.deadlocks,
      p50Ms: num(t.p50_ms), p95Ms: num(t.p95_ms), p99Ms: num(t.p99_ms), meanMs: num(t.mean_ms), queueMs: num(t.queue_ms), netMs: num(t.net_ms), appMs: num(t.app_ms), poolMs: num(t.pool_ms), dbMs: num(t.db_ms),
    })),
    statementStats: stm.map((s): StatementStat => ({
      digest: s.digest, digestText: s.digest_text, txnName: s.txn_name ?? null, execCount: num(s.exec_count), avgMs: num(s.avg_ms), maxMs: num(s.max_ms), rowsExamined: num(s.rows_examined), rowsSent: num(s.rows_sent),
      rowsAffected: num(s.rows_affected), noIndexUsed: num(s.no_index_used), lockTimeMs: num(s.lock_time_ms), explain: s.explain_json === null ? null : json(s.explain_json),
    })),
    lockWaits: locks.map((l): LockWaitRow => ({ seq: l.seq, atMs: l.at_ms, waitingTxn: l.waiting_txn, blockingTxn: l.blocking_txn, tableName: l.table_name, indexName: l.index_name ?? null, lockMode: l.lock_mode, lockData: l.lock_data ?? null })),
    invariants: inv.map((i): InvariantResult => ({ name: i.invariant_name, description: i.description, sql: i.sql_text, violations: num(i.violations), passed: !!i.passed, ...(i.error_text ? { error: i.error_text } : {}) })),
    findings: fnd.map((x): Finding => ({
      findingNo: x.finding_no, severity: x.severity, kind: x.kind, title: x.title, explanation: x.explanation, evidence: (json(x.evidence_json) as Record<string, unknown>) ?? {},
      fix: x.fix_json ? (json(x.fix_json) as FindingFix) : null, ...(x.fix_label ? { fixLabel: x.fix_label } : {}),
    })),
    slo: row.slo_pass === null ? null : { pass: !!row.slo_pass, reasons },
    bottleneck: row.bottleneck_json ? (json(row.bottleneck_json) as Bottleneck) : null,
    capacity,
    cacheHitRatio: row.cache_hit_ratio === null ? null : num(row.cache_hit_ratio),
  };
}

/** Marks every non-terminal run FAILED (server restart). Returns the number of runs touched. */
export async function failStaleRuns(): Promise<number> {
  const [res] = await appPool.query<ResultSetHeader>(
    `UPDATE run SET status = 'FAILED', error_text = 'The server restarted while this run was in progress', finished_at = NOW(3)
      WHERE status NOT IN ('COMPLETED','FAILED','CANCELLED')`);
  return res.affectedRows;
}

export async function setRunSettings(runId: string, settings: Record<string, unknown>): Promise<void> {
  await appPool.query('UPDATE run SET settings_json = ? WHERE run_id = ?', [JSON.stringify(settings), runId]);
}
