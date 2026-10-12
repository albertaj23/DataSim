import { z } from 'zod';
import { DesignDoc, Isolation, StrategyVariant } from './design';

export const RUN_KINDS = ['LOAD', 'CAPACITY', 'STRATEGY_CHILD'] as const;
export const RUN_STATUSES = ['QUEUED', 'PROVISIONING', 'WARMING', 'RUNNING', 'ANALYZING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type RunKind = (typeof RUN_KINDS)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export const isTerminal = (s: RunStatus) => s === 'COMPLETED' || s === 'FAILED' || s === 'CANCELLED';

/** Every number shown in the UI carries one of these. */
export type Provenance = 'MEASURED' | 'EMULATED' | 'PROJECTED';

/** Run-time overrides (quick selectors + e2e short runs). All optional. */
export const RunOverrides = z.object({
  strategy: StrategyVariant.optional(),
  isolation: Isolation.optional(),
  vus: z.number().int().min(1).max(500).optional(),
  durationS: z.number().min(1).max(600).optional(),
  warmupS: z.number().min(0).max(60).optional(),
  seed: z.number().int().optional(),
  /** Multiply every table's seedRows (e2e uses small values). */
  rowScale: z.number().min(0.001).max(10).optional(),
  capacitySteps: z.array(z.number().int().min(1).max(500)).min(2).max(10).optional(),
  capacityStepDurationS: z.number().min(2).max(120).optional(),
});
export type RunOverrides = z.infer<typeof RunOverrides>;
export const RunRequest = z.object({ kind: z.enum(['LOAD', 'CAPACITY']), overrides: RunOverrides.default({}) });
export type RunRequest = z.infer<typeof RunRequest>;

// ---------------------------------------------------------------- report pieces
export interface RunSummary {
  runId: string; projectId: string; projectName?: string; revisionNo: number;
  kind: RunKind; status: RunStatus; parentRunId: string | null;
  strategy: string; isolation: string; vus: number; durationS: number; seed: number; mysqlVersion: string | null;
  startedAt: string | null; finishedAt: string | null;
  txnTotal: number; committed: number; rejected: number; errored: number; retries: number; deadlocks: number; lockTimeouts: number;
  tpsAvg: number; p50Ms: number; p95Ms: number; p99Ms: number;
  sloPass: boolean | null; errorText: string | null;
  invariantViolations: number;
}
export interface RunSample {
  tS: number; tps: number; p50Ms: number; p95Ms: number; p99Ms: number; errors: number; activeVus: number;
  appQueue: number; poolWaiting: number; threadsRunning: number; rowLockWaits: number; lockWaitMs: number;
  bpHitRatio: number | null; cacheHitRatio: number | null;
  retries?: number; deadlocks?: number;
  /** Live pills per canvas node: e.g. { tps: 812, p95: 41, pool: 16, poolMax: 16, hit: 0.87 }. Only on live socket events. */
  nodes?: Record<string, Record<string, number>>;
  /** Tier 2: invariant violations (per invariant name) from the in-run 5 s sampling. Only on live socket events, only on the second a fresh result arrived; never persisted. */
  invariants?: Record<string, number>;
}
export interface TxnStat {
  txnName: string; count: number; committed: number; rejected: number; errored: number; retries: number; deadlocks: number;
  p50Ms: number; p95Ms: number; p99Ms: number; meanMs: number;
  /** Where the time went, mean ms per request. queue+net+app+pool+db is approximately meanMs. */
  queueMs: number; netMs: number; appMs: number; poolMs: number; dbMs: number;
}
export interface StatementStat {
  digest: string; digestText: string; txnName: string | null; execCount: number; avgMs: number; maxMs: number;
  rowsExamined: number; rowsSent: number; rowsAffected: number; noIndexUsed: number; lockTimeMs: number;
  explain: unknown | null;
}
export interface LockWaitRow { seq: number; atMs: number; waitingTxn: string; blockingTxn: string; tableName: string; indexName: string | null; lockMode: string; lockData: string | null }
export interface InvariantResult { name: string; description?: string; sql: string; violations: number; passed: boolean; error?: string }
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type FindingKind =
  | 'FULL_SCAN' | 'FK_NO_INDEX' | 'HOT_ROW' | 'DEADLOCK_ORDER' | 'INVARIANT_NAIVE' | 'POOL_STARVATION' | 'LOW_CACHE_HIT' | 'SERIALIZABLE_COST' | 'SLO' | 'OTHER';
/** `fix` is machine-applicable when present: the UI posts it to POST /api/projects/:id/apply-fix to create a new revision. */
export type FindingFix =
  | { type: 'ADD_INDEX'; table: string; columns: string[]; name: string }
  | { type: 'SET_STRATEGY'; strategy: StrategyVariant }
  | { type: 'SET_POOL'; poolSize: number }
  | { type: 'SET_INSTANCES'; instances: number }
  | { type: 'ADD_CHECK'; table: string; expr: string };
export interface Finding {
  findingNo: number; severity: Severity; kind: FindingKind; title: string;
  /** 2-3 sentences of DBMS theory. */
  explanation: string;
  evidence: Record<string, unknown>;
  fix: FindingFix | null; fixLabel?: string;
}
export interface CapacityPoint { stepNo: number; vus: number; tps: number; p50Ms: number; p95Ms: number; errorRate: number; runId?: string }
export interface CapacityFit { sigma: number; kappa: number; lambda: number; nPeak: number; xMax: number; r2: number }
export interface CapacityResult { points: CapacityPoint[]; fit: CapacityFit | null; kneeVus: number | null; sustainedVus: number | null; sentence: string }
export interface Bottleneck { nodeId: string; kind: 'app' | 'pool' | 'db' | 'cache' | 'network'; reason: string; severity: 'warning' | 'critical' }
export interface SloVerdict { pass: boolean; reasons: string[] }

export interface RunReport {
  run: RunSummary;
  settings: Record<string, unknown>;
  design: DesignDoc;
  samples: RunSample[];
  txnStats: TxnStat[];
  statementStats: StatementStat[];
  lockWaits: LockWaitRow[];
  invariants: InvariantResult[];
  findings: Finding[];
  slo: SloVerdict | null;
  bottleneck: Bottleneck | null;
  capacity: CapacityResult | null;
  /** Cache hit ratio over the measured window; null when the design has no cache. */
  cacheHitRatio: number | null;
}

// ---------------------------------------------------------------- socket events (room `run:<id>`; client joins with emit('join_run', {runId}))
export interface RunStatusEvent { runId: string; status: RunStatus; phase: string; elapsedS?: number; totalS?: number; message?: string; step?: { n: number; of: number; vus: number } }
export interface ProvisionProgressEvent { runId: string; table: string; rows: number; totalRows: number; doneRows: number; allRows: number }
export type RunSampleEvent = { runId: string; sample: RunSample };
export interface RunLocksEvent { runId: string; edges: { waiting: string; blocking: string; table: string | null; mode: string | null }[] }
export interface RunFinishedEvent { runId: string; status: RunStatus; sloPass: boolean | null }
export const SOCKET_EVENTS = { status: 'run:status', progress: 'run:provision-progress', sample: 'run:sample', locks: 'run:locks', finished: 'run:finished' } as const;
