import type { DesignDoc } from './design';
import type { Problem } from './problems';
import type { FindingFix, RunKind, RunReport, RunStatus, RunSummary } from './run';

// REST DTOs (all under /api). Errors are { code, message?, issues? } with a 4xx/5xx status.

export interface ProjectSummary {
  projectId: string; name: string; description: string; templateKey: string | null;
  createdAt: string; updatedAt: string; archivedAt: string | null;
  latestRevisionNo: number | null;
  lastRun: { runId: string; sloPass: boolean | null; p95Ms: number; status: RunStatus; kind: RunKind } | null;
}
/** `design` is the current draft (autosaved); `pinnedRevisionNo` is the latest immutable revision (null when never saved). */
export interface ProjectDetail extends ProjectSummary { design: DesignDoc; draftUpdatedAt: string; pinnedRevisionNo: number | null; dirty: boolean }
export interface RevisionInfo { revisionNo: number; contentHash: string; note: string; createdAt: string }
export interface TemplateInfo { key: string; name: string; summary: string; tags: string[]; tier: 1 | 2 }

export interface CreateProjectBody { name: string; description?: string; templateKey?: string }
export interface SaveRevisionBody { note?: string }
export interface ApplyFixBody { fix: FindingFix; note?: string }
export interface ValidateResponse { problems: Problem[]; errorCount: number; warningCount: number }

export interface ProvisionResponse { database: string; tables: number; rows: number; ms: number }
export interface TestTxnBody { txnName: string; variant?: string }
export interface TestTxnResponse {
  txnName: string; variant: string; params: Record<string, unknown>; outcome: 'COMMITTED_THEN_ROLLED_BACK' | 'REJECTED' | 'ERROR'; message?: string;
  steps: Array<{ index: number; sql: string; rows: unknown[]; rowCount: number; affected: number | null; ms: number; guard?: { passed: boolean; detail: string }; error?: string }>;
}
export interface QueryBody { sql: string }
export interface QueryResponse { columns: string[]; rows: unknown[][]; truncated: boolean; ms: number }

export interface CompareBody { runIds: string[] }
export interface CompareResponse { runs: RunReport[] }
export interface CompareStrategiesResponse { parentRunId: string; runIds: string[] }

export interface HealthResponse {
  ok: boolean;
  mysql: { ok: boolean; version: string | null; performanceSchema: boolean; error?: string };
  redis: { ok: boolean; error?: string };
  runner: { ok: boolean; error?: string };
  /** Non-null while a run holds the global lock. */
  activeRunId: string | null;
}
export interface RunListQuery { projectId?: string; kind?: RunKind; verdict?: 'pass' | 'fail' }
export type RunListResponse = RunSummary[];
export interface StartRunResponse { runId: string }
export interface DdlResponse { statements: string[]; sql: string }
