export type Scalar = string | number | boolean | null;
export type FieldType = 'INTEGER' | 'DECIMAL' | 'TEXT' | 'BOOLEAN';

export interface ModelField {
  id: string; name: string; type: FieldType; nullable: boolean; primaryKey: boolean; unique: boolean;
}

export interface ModelEntity {
  id: string; name: string; fields: ModelField[]; fixtures: Record<string, Scalar>[];
}

export interface ModelRelation {
  id: string; fromEntity: string; fromField: string; toEntity: string; toField: string;
}

export type OperationValue =
  | { kind: 'literal'; value: Scalar }
  | { kind: 'read-field'; variable: string; fieldId: string; offset?: number }
  | { kind: 'increment'; amount: number };

export type WorkspaceOperation =
  | { type: 'read'; entityId: string; keyFieldId: string; key: Scalar; lock: boolean; as: string }
  | { type: 'update'; entityId: string; keyFieldId: string; key: Scalar; changes: { fieldId: string; value: OperationValue }[]; guard?: { kind: 'field-lt-field'; leftFieldId: string; rightFieldId: string } }
  | { type: 'insert'; entityId: string; values: Record<string, Scalar> }
  | { type: 'delete'; entityId: string; keyFieldId: string; key: Scalar }
  | { type: 'barrier'; name: string }
  | { type: 'wait'; durationMs: number }
  | { type: 'commit' }
  | { type: 'rollback' };

export interface TransactionActor { id: string; name: string; operations: WorkspaceOperation[] }

export type WorkspaceInvariant =
  | { id: string; description: string; kind: 'row-field-nonnegative'; entityId: string; fieldId: string }
  | { id: string; description: string; kind: 'row-field-equals'; entityId: string; fieldId: string; value: number }
  | { id: string; description: string; kind: 'row-field-lte'; entityId: string; leftFieldId: string; rightFieldId: string };

export interface WorkspaceDefinition {
  schemaVersion: 1;
  entities: ModelEntity[];
  relations: ModelRelation[];
  actors: TransactionActor[];
  invariants: WorkspaceInvariant[];
}

export interface WorkspaceSummary {
  id: string; name: string; description: string; revision: number; contentHash: string;
  archived: boolean; createdAt: string; updatedAt: string; lastActivityAt: string;
  runCount: number; latestRunStatus: string | null;
}

export interface Workspace extends WorkspaceSummary { definition: WorkspaceDefinition }
export interface WorkspaceTemplate { id: string; title: string; description: string }
export interface ValidationProblem { path: string; message: string }
export interface ValidationResponse {
  valid: boolean; problems: ValidationProblem[];
  capabilities: {
    engine: string; modes: string[]; isolationLevels: string[];
    maxActors: number; maxTrials: number; supportsActorConcurrency: boolean;
    maxBatchCells: number; maxBatchActorTrials: number;
  };
}

export interface RunConfiguration {
  runMode: 'LIVE_DBMS' | 'GUIDED_SCHEDULE';
  isolation: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  concurrency?: number;
  trials: number; seed: number; timeoutMs: number;
}

export interface RunSummary {
  id: string; workspaceId: string; revision: number; revisionHash: string;
  configuration: RunConfiguration; runMode: string; engine: string; engineVersion: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'; seed: number;
  summary: {
    violations: number; trials: number; invariantChecks: number; durationMs: number; p50Ms: number | null; p95Ms: number | null;
    partial?: boolean;
    invariants: { id: string; description: string; passed: boolean; failures: string[] }[];
    outcomes: { trial: number; durationMs: number; invariants: { id: string; description: string; passed: boolean; failures: string[] }[]; finalState: Record<string, Record<string, Record<string, Scalar>>> }[];
  } | null;
  error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null;
}

export interface ExperimentBatchCell {
  index: number;
  concurrency: number;
  isolation: RunConfiguration['isolation'];
  runId: string | null;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  trialsCompleted: number;
  p50Ms: number | null;
  p95Ms: number | null;
  violations: number | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ExperimentBatchConfiguration {
  runMode: RunConfiguration['runMode'];
  concurrencies: number[];
  isolationLevels: RunConfiguration['isolation'][];
  trials: number;
  seed: number;
  timeoutMs: number;
  seedPolicy: 'same_metadata_seed_per_cell';
  aggregationDefinition: {
    metric: 'p95_actor_time_per_trial';
    method: 'nearest_rank_ceil_95_percent';
    unit: 'ms';
    sample: string;
  };
}

export interface ExperimentBatch {
  id: string;
  workspaceId: string;
  workspaceName: string;
  revision: number;
  revisionHash: string;
  configuration: ExperimentBatchConfiguration;
  engine: string;
  engineVersion: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL' | 'CANCELLED';
  totalCells: number;
  completedCells: number;
  finishedCells: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cells?: ExperimentBatchCell[];
}

export interface RunEvent {
  sequence: number; type: string; actorId: string | null;
  source: 'DBMS_OBSERVED' | 'DATASIM_DERIVED' | 'MODELED'; at: string; sql: string | null;
  payload: Record<string, unknown>;
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export function newField(id = createId('field')): ModelField {
  return { id, name: 'New field', type: 'TEXT', nullable: true, primaryKey: false, unique: false };
}

export function newEntity(): ModelEntity {
  const id = createId('table');
  const key = newField('id');
  key.name = 'id';
  key.type = 'INTEGER';
  key.nullable = false;
  key.primaryKey = true;
  key.unique = true;
  return { id, name: 'New table', fields: [key], fixtures: [{ id: 1 }] };
}

export function defaultOperation(type: WorkspaceOperation['type'], entity?: ModelEntity): WorkspaceOperation {
  const keyField = entity?.fields.find((field) => field.primaryKey);
  const key = entity?.fixtures[0]?.[keyField?.id ?? ''] ?? 1;
  switch (type) {
    case 'read': return { type, entityId: entity?.id ?? '', keyFieldId: keyField?.id ?? '', key, lock: false, as: 'row' };
    case 'update': return { type, entityId: entity?.id ?? '', keyFieldId: keyField?.id ?? '', key, changes: [{ fieldId: entity?.fields.find((field) => !field.primaryKey)?.id ?? '', value: { kind: 'increment', amount: 1 } }] };
    case 'insert': return { type, entityId: entity?.id ?? '', values: Object.fromEntries((entity?.fields ?? []).map((field) => [field.id, field.type === 'TEXT' ? '' : 0])) };
    case 'delete': return { type, entityId: entity?.id ?? '', keyFieldId: keyField?.id ?? '', key };
    case 'barrier': return { type, name: 'both_read' };
    case 'wait': return { type, durationMs: 100 };
    case 'commit': return { type };
    case 'rollback': return { type };
  }
}
