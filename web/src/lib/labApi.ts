// Types for the legacy Concurrency Lab and Transaction Stepper endpoints (/api/lab/*).
// Copied from the v1 client (git: v1-friend:web/src/lib/api.ts); the server contracts are unchanged.
// Legacy table names (account, device, playback_session, playback_event) are shown to users with
// Review 1 vocabulary: see LEGACY_TABLES in features/lab/logic.ts.

export type StrategyName = 'NAIVE' | 'TXN_RR' | 'SERIALIZABLE' | 'PESSIMISTIC' | 'OPTIMISTIC' | 'CONSTRAINT' | 'TRIGGER' | 'REDIS_LEASE';
export const STRATEGY_NAMES: StrategyName[] = ['NAIVE', 'TXN_RR', 'SERIALIZABLE', 'PESSIMISTIC', 'OPTIMISTIC', 'CONSTRAINT', 'TRIGGER', 'REDIS_LEASE'];

export type LabIsolation = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
export type RaceMode = 'NORMAL' | 'TAKEOVER';

// -------------------------------------------------------------- Concurrency Lab

/** POST /lab/experiments */
export interface ExperimentRequest {
  strategy: StrategyName; isolation?: LabIsolation; concurrency: number; accounts: number; maxStreams: number;
  raceDelayMs: number; mode: RaceMode; trials: number; batchId?: string;
}
export interface TrialResult {
  strategy: StrategyName; isolationUsed: string; concurrency: number; accounts: number; maxStreams: number; raceDelayMs: number; mode: RaceMode;
  granted: number; rejected: number; errors: number; retries: number; deadlocks: number; lockTimeouts: number; violations: number;
  p50Ms: number; p95Ms: number; wallMs: number; throughputRps: number; errorSamples: string[];
  runId: number; batchId: string; trial: number;
}
export interface Aggregate {
  strategy: StrategyName; isolationUsed: string; trials: number;
  violationsTotal: number; trialsWithViolations: number; violationsMean: number; violationsMax: number;
  grantedMean: number; retriesMean: number; deadlocksMean: number; lockTimeoutsTotal: number; errorsTotal: number;
  p50Median: number; p95Median: number; throughputMean: number;
}
export interface ExperimentResponse { batchId: string; trials: TrialResult[]; aggregate: Aggregate }

export type LostUpdateVariant = 'NAIVE_RMW' | 'ATOMIC' | 'LOCKED' | 'CAS';
export const LOST_UPDATE_VARIANTS: LostUpdateVariant[] = ['NAIVE_RMW', 'ATOMIC', 'LOCKED', 'CAS'];
/** POST /lab/lost-update */
export interface LostUpdateRequest { variant: LostUpdateVariant; increments: number; raceDelayMs: number; trials: number; batchId?: string }
export interface LostUpdateResult {
  variant: LostUpdateVariant; increments: number; raceDelayMs: number;
  isolationUsed: string; succeeded: number; errors: number; retries: number; deadlocks: number;
  finalCount: number; lost: number; p50Ms: number; p95Ms: number; wallMs: number; throughputRps: number;
  runId: number; batchId: string; trial: number;
}
export interface LostUpdateAggregate {
  variant: LostUpdateVariant; isolationUsed: string; trials: number;
  finalCountMean: number; lostTotal: number; trialsWithLoss: number; lostMean: number;
  retriesMean: number; errorsTotal: number; p50Median: number; p95Median: number; throughputMean: number;
}
export interface LostUpdateResponse { batchId: string; trials: LostUpdateResult[]; aggregate: LostUpdateAggregate }

/** GET /lab/runs: one persisted trial (table experiment_run). */
export interface ExperimentRun {
  runId: number; experiment: 'STREAM_LIMIT' | 'LOST_UPDATE'; strategy: string; isolationLevel: string;
  mode: RaceMode; concurrency: number; accounts: number; maxStreams: number; raceDelayMs: number;
  granted: number; rejected: number; retries: number; deadlocks: number; lockTimeouts: number;
  errors: number; violations: number; p50Ms: number; p95Ms: number; throughputRps: number; wallMs: number;
  batchId: string | null; trial: number; source: 'UI' | 'API' | 'BENCH' | 'TEST' | 'SIM'; detail: unknown; createdAt: string;
}

/** POST /lab/index-experiment */
export interface IndexVariant {
  variant: 'WITH_INDEX' | 'WITHOUT_COMPOSITE' | 'WITHOUT_ANY_INDEX';
  explain: { key: string | null; type: string | null; rows: number | null; extra: string | null };
  explainAnalyze: string; countMs: number; locksHeld: number; recordLocks: number; tableLocks: number;
  otherAccountBlocked: boolean; otherAccountMs: number;
}
export interface IndexExperimentResult { historyRows: number; accountsTouched: number; variants: IndexVariant[]; finding: string }

// -------------------------------------------------------------- Transaction Stepper

export type TxnLabel = 'T1' | 'T2';
export type StepStatus = 'PENDING' | 'WAITING' | 'DONE' | 'ERROR' | 'KILLED';

export interface StepResultView {
  index: number; display: string; status: StepStatus; resolvedSql?: string;
  rows?: unknown; affectedRows?: number; errno?: number; errorMessage?: string; deadlockText?: string;
}
export interface TxnView {
  label: TxnLabel; connId: number | null; isolation: string | null; killed: boolean; busy: boolean;
  steps: StepResultView[]; cursor: number;
}
export interface StepperStateView { scenarioId: string | null; accountIds: number[]; txns: Record<TxnLabel, TxnView> }
/** Socket.IO `stepper_update` payload. */
export interface StepperUpdate { txn: TxnLabel; index: number; result: StepResultView | null; killed?: boolean }

/** GET /lab/stepper/scenarios */
export interface StepperScenario {
  id: string; title: string; syllabusRefs: string[]; expected: string; explanation: string; suggestedOrder: string[];
}

/** GET /lab/locks (performance_schema.data_locks + data_lock_waits) */
export type LockOwner = TxnLabel | 'other';
export interface LockRow {
  connId: number; label: LockOwner; table: string; index: string | null;
  type: string; mode: string; status: 'GRANTED' | 'WAITING'; data: string | null;
}
export interface WaitRow { waitingConn: number; waitingLabel: LockOwner; blockingConn: number; blockingLabel: LockOwner }
export interface LockSnapshot { locks: LockRow[]; waits: WaitRow[]; cycle: boolean }

/** GET /lab/stepper/invariant */
export interface InvariantBreach { accountId: number; maxStreams: number; active: number }
export interface InvariantResult { breaches: InvariantBreach[]; violations: number }

/** Error body returned by the lab routes: { code, message } (409 BUSY, 400 BAD_PARAMS, 400 STEPPER_ERROR). */
export interface LabErrorBody { code?: string; message?: string }
