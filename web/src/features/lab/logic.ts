// Pure helpers for the Concurrency Lab: copy per strategy, aggregation of persisted trials,
// CSV / Markdown export, and error wording. No React, no DOM (except download()).
import { OFFLINE_MESSAGE } from '../../lib/api';
import type {
  Aggregate, ExperimentRun, LostUpdateAggregate, LostUpdateVariant, StrategyName,
} from '../../lib/labApi';

// ---------------------------------------------------------------- legacy names

/** Legacy table -> Review 1 entity (brief section 3). The tables are not renamed; only the wording is. */
export const LEGACY_TABLES: Record<string, { entity: string; plural: string }> = {
  account: { entity: 'user_account', plural: 'accounts' },
  device: { entity: 'client', plural: 'clients' },
  playback_session: { entity: 'allocation', plural: 'allocations' },
  playback_event: { entity: 'operation_event', plural: 'events' },
  experiment_run: { entity: 'experiment_run', plural: 'experiment runs' },
  song: { entity: 'resource', plural: 'resources' },
};

/** "allocations" for playback_session; unknown names pass through. */
export function reviewName(table: string): string {
  return LEGACY_TABLES[table]?.plural ?? table;
}

// ---------------------------------------------------------------- strategy copy

export interface StrategyInfo {
  name: StrategyName;
  /** The DBMS idea it demonstrates. */
  theory: string;
  /** One or two sentences: what it does and what to expect. */
  text: string;
  /** What the invariant check should show at quota 1 under contention. */
  expect: 'violations' | 'safe' | 'rare';
}

export const STRATEGY_INFO: Record<StrategyName, StrategyInfo> = {
  NAIVE: {
    name: 'NAIVE', theory: 'lost update', expect: 'violations',
    text: 'Autocommit, no transaction: count active allocations, wait, then insert. Concurrent claims all read the same count, so the limit is exceeded.',
  },
  TXN_RR: {
    name: 'TXN_RR', theory: 'MVCC · write skew', expect: 'violations',
    text: 'Read and write in one REPEATABLE READ transaction. Each transaction reads a consistent snapshot, which does not stop two of them acting on the same stale fact (write skew).',
  },
  SERIALIZABLE: {
    name: 'SERIALIZABLE', theory: 'strict 2PL · gap locks', expect: 'safe',
    text: 'Plain reads become shared next-key locks. Correct, but conflicting transactions wait or deadlock and one is rolled back and retried.',
  },
  PESSIMISTIC: {
    name: 'PESSIMISTIC', theory: 'strict 2PL', expect: 'safe',
    text: 'SELECT ... FOR UPDATE on the account row before counting. Claims for one account queue behind the row lock, so the check and the write are atomic.',
  },
  OPTIMISTIC: {
    name: 'OPTIMISTIC', theory: 'CAS · version check', expect: 'safe',
    text: 'Read state_version without locks, then UPDATE ... WHERE state_version = ?. A stale version affects 0 rows and the claim retries. No blocking, but retries grow with contention.',
  },
  CONSTRAINT: {
    name: 'CONSTRAINT', theory: 'constraint in the schema', expect: 'safe',
    text: 'A unique index on a generated column allows one active allocation per account; the database rejects the second insert. Only valid for quota = 1.',
  },
  TRIGGER: {
    name: 'TRIGGER', theory: 'trigger check', expect: 'rare',
    text: 'A BEFORE INSERT trigger counts active rows and raises SQLSTATE 45000 at the limit. It looks airtight, but at READ COMMITTED two triggers can both count before either row exists, so rare violations remain.',
  },
  REDIS_LEASE: {
    name: 'REDIS_LEASE', theory: 'lease · atomic primitive', expect: 'safe',
    text: 'Redis hands out one slot key per unit of quota with SET NX PX in one Lua script, so admission is atomic and expires on its own. Needs Redis; two stores can briefly disagree.',
  },
};

export interface LostUpdateInfo { name: LostUpdateVariant; theory: string; text: string; expect: 'violations' | 'safe' }

export const LOST_UPDATE_INFO: Record<LostUpdateVariant, LostUpdateInfo> = {
  NAIVE_RMW: {
    name: 'NAIVE_RMW', theory: 'lost update', expect: 'violations',
    text: 'Autocommit: SELECT the counter, sleep, write value + 1. Two workers read the same value and one increment is overwritten.',
  },
  ATOMIC: {
    name: 'ATOMIC', theory: 'single-statement update', expect: 'safe',
    text: 'UPDATE counter = counter + 1. The read-modify-write happens under the row lock inside one statement, so there is no window to race in.',
  },
  LOCKED: {
    name: 'LOCKED', theory: 'strict 2PL', expect: 'safe',
    text: 'SELECT ... FOR UPDATE, then write back. Correct, but workers queue one at a time, so wall time grows with increments x race delay.',
  },
  CAS: {
    name: 'CAS', theory: 'compare-and-set', expect: 'safe',
    text: 'UPDATE ... WHERE counter = :read. If another worker moved it, 0 rows are affected and the worker retries with a fresh read.',
  },
};

// ---------------------------------------------------------------- result rows

export interface ResultRow {
  key: string;
  name: string;
  isolation: string;
  trials: number;
  /** Violations (allocation limit) or lost increments (lost update), summed over trials. */
  violations: number;
  /** Share of trials with at least one violation, 0..100. */
  violatingPct: number;
  retries: number;
  deadlocks: number;
  errors: number;
  p50: number;
  p95: number;
  rps: number;
}

/** Per-trial means: at most one decimal, no trailing zeros (70.2, 0.9, 12). */
export const fmtMean = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
/** Tooltip text for a per-trial mean: the total it stands for. */
export const meanTitle = (mean: number, trials: number) => `${fmtMean(mean * trials)} in total over ${trials} ${trials === 1 ? 'trial' : 'trials'}`;
/** One-line caveat shown under every table that reports per-trial retries and deadlocks. */
export const MEAN_NOTE = 'Retries and deadlocks are means per trial (hover for totals). Deadlock counts can exceed retries: a deadlocked attempt that exhausts its retries is counted without a retry.';

export const pctOf = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export function streamRow(a: Aggregate): ResultRow {
  return {
    key: a.strategy, name: a.strategy, isolation: a.isolationUsed, trials: a.trials,
    violations: a.violationsTotal, violatingPct: pctOf(a.trialsWithViolations, a.trials),
    retries: a.retriesMean, deadlocks: a.deadlocksMean, errors: a.errorsTotal,
    p50: a.p50Median, p95: a.p95Median, rps: a.throughputMean,
  };
}

export function lostRow(a: LostUpdateAggregate): ResultRow {
  return {
    key: a.variant, name: a.variant, isolation: a.isolationUsed, trials: a.trials,
    violations: a.lostTotal, violatingPct: pctOf(a.trialsWithLoss, a.trials),
    retries: a.retriesMean, deadlocks: 0, errors: a.errorsTotal,
    p50: a.p50Median, p95: a.p95Median, rps: a.throughputMean,
  };
}

export type ChartMetric = 'violations' | 'p95' | 'rps' | 'retries';
export const CHART_METRICS: { value: ChartMetric; label: string; unit: string }[] = [
  { value: 'violations', label: 'Violations', unit: '' },
  { value: 'p95', label: 'p95', unit: ' ms' },
  { value: 'rps', label: 'Throughput', unit: ' /s' },
  { value: 'retries', label: 'Retries / trial', unit: '' },
];

export function metricOf(r: ResultRow, m: ChartMetric): number {
  return m === 'violations' ? r.violations : m === 'p95' ? r.p95 : m === 'rps' ? r.rps : r.retries;
}

// ---------------------------------------------------------------- aggregation of persisted trials

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface RunAggregate extends ResultRow {
  experiment: ExperimentRun['experiment'];
  batchId: string | null;
  createdAt: string;
  source: ExperimentRun['source'];
  concurrency: number;
  accounts: number;
  maxStreams: number;
  raceDelayMs: number;
  mode: string;
  lockTimeouts: number;
}

/**
 * Groups persisted trials by (batch, experiment, strategy) and aggregates them the way the server does
 * for a live response: violations summed, retries/deadlocks/throughput averaged, latencies medianed.
 * Rows without a batch id stay separate (one group per run id). Newest group first.
 */
export function aggregateRuns(rows: ExperimentRun[]): RunAggregate[] {
  const groups = new Map<string, ExperimentRun[]>();
  for (const r of rows) {
    const key = `${r.batchId ?? `run-${r.runId}`}|${r.experiment}|${r.strategy}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  const out: RunAggregate[] = [];
  for (const [key, g] of groups) {
    const first = g[0]!;
    out.push({
      key, name: first.strategy, isolation: first.isolationLevel, trials: g.length,
      violations: g.reduce((a, r) => a + r.violations, 0),
      violatingPct: pctOf(g.filter((r) => r.violations > 0).length, g.length),
      retries: r2(mean(g.map((r) => r.retries))), deadlocks: r2(mean(g.map((r) => r.deadlocks))),
      errors: g.reduce((a, r) => a + r.errors, 0),
      p50: r2(median(g.map((r) => r.p50Ms))), p95: r2(median(g.map((r) => r.p95Ms))),
      rps: r2(mean(g.map((r) => r.throughputRps))),
      experiment: first.experiment, batchId: first.batchId, createdAt: g.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), first.createdAt),
      source: first.source, concurrency: first.concurrency, accounts: first.accounts, maxStreams: first.maxStreams,
      raceDelayMs: first.raceDelayMs, mode: first.mode, lockTimeouts: g.reduce((a, r) => a + r.lockTimeouts, 0),
    });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

// ---------------------------------------------------------------- export

export function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const RAW_COLUMNS: [string, (r: ExperimentRun) => unknown][] = [
  ['run_id', (r) => r.runId], ['created_at', (r) => r.createdAt], ['experiment', (r) => r.experiment], ['strategy', (r) => r.strategy],
  ['isolation', (r) => r.isolationLevel], ['mode', (r) => r.mode], ['concurrency', (r) => r.concurrency], ['accounts', (r) => r.accounts],
  ['quota_max_active', (r) => r.maxStreams], ['race_delay_ms', (r) => r.raceDelayMs], ['granted', (r) => r.granted], ['rejected', (r) => r.rejected],
  ['retries', (r) => r.retries], ['deadlocks', (r) => r.deadlocks], ['lock_timeouts', (r) => r.lockTimeouts], ['errors', (r) => r.errors],
  ['violations', (r) => r.violations], ['p50_ms', (r) => r.p50Ms], ['p95_ms', (r) => r.p95Ms], ['throughput_rps', (r) => r.throughputRps],
  ['wall_ms', (r) => r.wallMs], ['batch_id', (r) => r.batchId], ['trial', (r) => r.trial], ['source', (r) => r.source],
];

/** One line per persisted trial (same columns as the experiment_run table). */
export function trialsToCsv(rows: ExperimentRun[]): string {
  const head = RAW_COLUMNS.map(([h]) => h).join(',');
  return [head, ...rows.map((r) => RAW_COLUMNS.map(([, f]) => csvCell(f(r))).join(','))].join('\n') + '\n';
}

const AGG_COLUMNS: [string, (a: RunAggregate) => unknown][] = [
  ['batch_id', (a) => a.batchId], ['created_at', (a) => a.createdAt], ['experiment', (a) => a.experiment], ['strategy', (a) => a.name],
  ['isolation', (a) => a.isolation], ['trials', (a) => a.trials], ['concurrency', (a) => a.concurrency], ['accounts', (a) => a.accounts],
  ['quota_max_active', (a) => a.maxStreams], ['race_delay_ms', (a) => a.raceDelayMs], ['violations_total', (a) => a.violations],
  ['trials_violating_pct', (a) => a.violatingPct], ['retries_mean', (a) => a.retries], ['deadlocks_mean', (a) => a.deadlocks],
  ['errors_total', (a) => a.errors], ['p50_ms_median', (a) => a.p50], ['p95_ms_median', (a) => a.p95], ['throughput_rps_mean', (a) => a.rps],
];

export function aggregatesToCsv(rows: RunAggregate[]): string {
  const head = AGG_COLUMNS.map(([h]) => h).join(',');
  return [head, ...rows.map((a) => AGG_COLUMNS.map(([, f]) => csvCell(f(a))).join(','))].join('\n') + '\n';
}

const mdCell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Markdown report: parameters, then one results table. `title` is the heading. */
export function aggregatesToMarkdown(rows: RunAggregate[], title = 'Concurrency Lab results', generatedAt = new Date()): string {
  const lines = [
    `# ${title}`, '',
    `Generated ${generatedAt.toISOString()}. Source: experiment_run (Review 1 EXPERIMENT_RUN). Violations, retries, deadlocks and latencies are MEASURED on MySQL 8.4 / InnoDB; the race delay is an EMULATED sleep between check and write.`, '',
  ];
  if (rows.length === 0) return [...lines, 'No runs.', ''].join('\n');
  lines.push(
    '| Batch | Experiment | Strategy | Isolation | Trials | Conc. | Accts | Quota (max active) | Delay ms | Violations | Trials violating | Retries / trial | Deadlocks / trial | Errors | p50 ms | p95 ms | Throughput /s |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const a of rows) {
    lines.push(`| ${mdCell(a.batchId?.slice(0, 8) ?? '-')} | ${a.experiment === 'STREAM_LIMIT' ? 'allocation limit' : 'lost update'} | ${mdCell(a.name)} | ${mdCell(a.isolation)} | ${a.trials} | ${a.concurrency} | ${a.accounts} | ${a.maxStreams} | ${a.raceDelayMs} | ${a.violations} | ${a.violatingPct}% | ${a.retries} | ${a.deadlocks} | ${a.errors} | ${a.p50} | ${a.p95} | ${a.rps} |`);
  }
  lines.push('', 'Legacy table names: account = user_account, device = client, playback_session = allocation, playback_event = operation_event, song = resource.', '');
  return lines.join('\n');
}

/** Browser download of a text blob. */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- errors

export interface LabFailure { status: number; code?: string; message?: string }

/**
 * User-facing text for a failed lab call. 409 = the lab named lock is held; REDIS_LEASE and TRIGGER
 * get dependency-specific wording because they are the two strategies that need something beyond MySQL tables.
 */
export function labErrorMessage(f: LabFailure, strategy?: string): string {
  if (f.status === 0) return OFFLINE_MESSAGE;
  if (f.status === 409) return 'Another experiment is running (UI, CLI bench or test suite). Try again when it finishes.';
  const msg = f.message ?? `Request failed (${f.status})`;
  if (f.status === 400) return msg;
  if (strategy === 'REDIS_LEASE') return `Redis is unavailable, so REDIS_LEASE cannot run (${msg}). Start it with npm run db:up.`;
  if (strategy === 'TRIGGER') return `The trigger strategy could not run (${msg}). It needs the CREATE TRIGGER privilege on the datasim database.`;
  return msg;
}

/** Total strategies for a progress bar. */
export const progressPct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0);

/** Client-side mirror of the server's validate() so obvious mistakes fail before a request. DEVICES_PER_ACCOUNT = 64, LAB_POOL_SIZE default 120. */
export function validateStreamParams(p: { strategies: StrategyName[]; concurrency: number; accounts: number; maxStreams: number }): string | null {
  if (p.strategies.length === 0) return 'Select at least one strategy.';
  if (p.concurrency > p.accounts * 64) return `Concurrency ${p.concurrency} needs more than 64 clients per account: raise accounts to ${Math.ceil(p.concurrency / 64)} or lower concurrency.`;
  if (p.concurrency > 100) return 'Concurrency is limited to 100.';
  return null;
}

/** Strategies that will really run, and the ones skipped with a reason. */
export function planStrategies(selected: StrategyName[], maxStreams: number, redisUp: boolean): { run: StrategyName[]; skipped: { name: StrategyName; reason: string }[] } {
  const run: StrategyName[] = [];
  const skipped: { name: StrategyName; reason: string }[] = [];
  for (const s of selected) {
    if (s === 'CONSTRAINT' && maxStreams > 1) skipped.push({ name: s, reason: 'CONSTRAINT only supports quota = 1.' });
    else if (s === 'REDIS_LEASE' && !redisUp) skipped.push({ name: s, reason: 'Redis is unreachable, so REDIS_LEASE cannot run. Start it with npm run db:up.' });
    else run.push(s);
  }
  return { run, skipped };
}
