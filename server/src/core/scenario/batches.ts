import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { appPool } from '../../db/pool.js';
import {
  cancelRun,
  getRun,
  getWorkspace,
  queuePinnedRun,
  type RunConfiguration,
  type StoredWorkspace,
} from './workspaces.js';
import { validateWorkspaceDefinition, type WorkspaceDefinition } from './schema.js';

const isolationLevels = ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'] as const;
const batchInputSchema = z.object({
  runMode: z.enum(['LIVE_DBMS', 'GUIDED_SCHEDULE']),
  concurrencies: z.array(z.number().int().min(1).max(8)).min(2).max(8),
  isolationLevels: z.array(z.enum(isolationLevels)).min(1).max(3),
  trials: z.number().int().min(1).max(10),
  seed: z.number().int().min(0).max(2_147_483_647),
  timeoutMs: z.number().int().min(2_000).max(30_000),
}).strict().superRefine((value, context) => {
  if (new Set(value.concurrencies).size !== value.concurrencies.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['concurrencies'], message: 'Concurrency values must be unique.' });
  }
  if (new Set(value.isolationLevels).size !== value.isolationLevels.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['isolationLevels'], message: 'Isolation levels must be unique.' });
  }
});

type BatchInput = z.infer<typeof batchInputSchema>;
type BatchStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL' | 'CANCELLED';
type CellStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

interface SavedBatchConfiguration extends BatchInput {
  seedPolicy: 'same_metadata_seed_per_cell';
  aggregationDefinition: {
    metric: 'p95_actor_time_per_trial';
    method: 'nearest_rank_ceil_95_percent';
    unit: 'ms';
    sample: 'one total concurrent actor execution duration per completed trial';
  };
}

interface BatchRow extends RowDataPacket {
  batch_id: string;
  workspace_id: string;
  workspace_name: string;
  revision: number;
  revision_hash: string;
  definition_snapshot: WorkspaceDefinition | string;
  configuration: SavedBatchConfiguration | string;
  engine: string;
  engine_version: string;
  status: BatchStatus;
  total_cells: number;
  completed_cells: number;
  finished_cells: number;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

interface CellRow extends RowDataPacket {
  batch_id: string;
  cell_index: number;
  concurrency_level: number;
  isolation_level: RunConfiguration['isolation'];
  run_id: string | null;
  status: CellStatus;
  trials_completed: number;
  p50_ms: number | string | null;
  p95_ms: number | string | null;
  violations: number | null;
  error_message: string | null;
  started_at: Date | null;
  finished_at: Date | null;
}

const batchControllers = new Map<string, AbortController>();
const activeBatchRuns = new Map<string, string>();

function decodeJson<T>(value: T | string): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function time(value: Date | null): string | null {
  return value ? (value instanceof Date ? value.toISOString() : new Date(value).toISOString()) : null;
}

function batchSummary(row: BatchRow) {
  const configuration = decodeJson(row.configuration);
  return {
    id: row.batch_id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    revision: Number(row.revision),
    revisionHash: row.revision_hash,
    configuration,
    engine: row.engine,
    engineVersion: row.engine_version,
    status: row.status,
    totalCells: Number(row.total_cells),
    completedCells: Number(row.completed_cells),
    finishedCells: Number(row.finished_cells),
    error: row.error_message,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    startedAt: time(row.started_at),
    finishedAt: time(row.finished_at),
  };
}

function mapCell(row: CellRow) {
  return {
    index: Number(row.cell_index),
    concurrency: Number(row.concurrency_level),
    isolation: row.isolation_level,
    runId: row.run_id,
    status: row.status,
    trialsCompleted: Number(row.trials_completed),
    p50Ms: row.p50_ms === null ? null : Number(row.p50_ms),
    p95Ms: row.p95_ms === null ? null : Number(row.p95_ms),
    violations: row.violations === null ? null : Number(row.violations),
    error: row.error_message,
    startedAt: time(row.started_at),
    finishedAt: time(row.finished_at),
  };
}

function configurationProblems(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export async function createExperimentBatch(
  workspaceId: string,
  input: unknown,
): Promise<{ batchId: string; status: BatchStatus } | { error: 'NOT_FOUND' | 'VALIDATION' | 'BAD_CONFIGURATION'; problems?: Array<{ path: string; message: string }> }> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace || workspace.archived) return { error: 'NOT_FOUND' };
  const validation = validateWorkspaceDefinition(workspace.definition);
  if (!validation.definition) return { error: 'VALIDATION', problems: validation.problems };
  const parsed = batchInputSchema.safeParse(input);
  if (!parsed.success) return { error: 'BAD_CONFIGURATION', problems: configurationProblems(parsed.error) };

  const configuration = parsed.data;
  const actorCount = validation.definition.actors.length;
  const problems: Array<{ path: string; message: string }> = [];
  configuration.concurrencies.forEach((value, index) => {
    if (value > actorCount) problems.push({ path: `concurrencies.${index}`, message: `Concurrency ${value} exceeds the ${actorCount} configured actor lane(s).` });
  });
  const totalCells = configuration.concurrencies.length * configuration.isolationLevels.length;
  if (totalCells > 12) problems.push({ path: 'concurrencies', message: 'A batch is limited to 12 configuration cells.' });
  const actorTrials = configuration.concurrencies.reduce((total, concurrency) => total + concurrency, 0)
    * configuration.isolationLevels.length * configuration.trials;
  if (actorTrials > 240) problems.push({ path: 'trials', message: `This matrix requests ${actorTrials} actor-trials; the maximum is 240.` });
  if (problems.length) return { error: 'BAD_CONFIGURATION', problems };

  const [versionRows] = await appPool.query<Array<RowDataPacket & { version: string }>>('SELECT VERSION() AS version');
  const engineVersion = versionRows[0]?.version ?? 'unknown';
  const savedConfiguration: SavedBatchConfiguration = {
    ...configuration,
    seedPolicy: 'same_metadata_seed_per_cell',
    aggregationDefinition: {
      metric: 'p95_actor_time_per_trial',
      method: 'nearest_rank_ceil_95_percent',
      unit: 'ms',
      sample: 'one total concurrent actor execution duration per completed trial',
    },
  };
  const batchId = randomUUID();
  const cells = configuration.concurrencies.flatMap((concurrency) => configuration.isolationLevels.map((isolation) => ({ concurrency, isolation })));
  const connection = await appPool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO scenario_experiment_batch
         (batch_id, workspace_id, revision, revision_hash, definition_snapshot, configuration,
          engine, engine_version, status, total_cells)
       VALUES (?, ?, ?, ?, ?, ?, 'MySQL/InnoDB', ?, 'QUEUED', ?)`,
      [
        batchId, workspace.id, workspace.revision, workspace.contentHash, JSON.stringify(workspace.definition),
        JSON.stringify(savedConfiguration), engineVersion, cells.length,
      ],
    );
    for (const [index, cell] of cells.entries()) {
      await connection.query(
        `INSERT INTO scenario_experiment_cell
           (batch_id, cell_index, concurrency_level, isolation_level, status)
         VALUES (?, ?, ?, ?, 'QUEUED')`,
        [batchId, index + 1, cell.concurrency, cell.isolation],
      );
    }
    await connection.query('UPDATE scenario_workspace SET last_activity_at = NOW(3) WHERE workspace_id = ?', [workspace.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const controller = new AbortController();
  batchControllers.set(batchId, controller);
  setImmediate(() => {
    void executeBatch(batchId, controller.signal).catch((error: unknown) => {
      console.error(`Experiment batch ${batchId} could not be finalized:`, error);
    });
  });
  return { batchId, status: 'QUEUED' };
}

async function markRemainingCancelled(batchId: string, message: string): Promise<void> {
  await appPool.query(
    `UPDATE scenario_experiment_cell
     SET status = 'CANCELLED', error_message = ?, finished_at = NOW(3)
     WHERE batch_id = ? AND status = 'QUEUED'`,
    [message.slice(0, 1000), batchId],
  );
  await appPool.query(
    `UPDATE scenario_experiment_cell
     SET status = 'FAILED', error_message = ?, finished_at = NOW(3)
     WHERE batch_id = ? AND status = 'RUNNING'`,
    [message.slice(0, 1000), batchId],
  );
  await appPool.query(
    `UPDATE scenario_experiment_batch
     SET finished_cells = total_cells, finished_at = NOW(3)
     WHERE batch_id = ?`,
    [batchId],
  );
}

function numeric(summary: unknown, key: string): number | null {
  if (!summary || typeof summary !== 'object' || !(key in summary)) return null;
  const value = (summary as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function executeBatch(batchId: string, signal: AbortSignal): Promise<void> {
  let currentRunId: string | undefined;
  const abortRun = () => {
    if (currentRunId) void cancelRun(currentRunId).catch((error: unknown) => console.error(`Could not cancel batch child run ${currentRunId}:`, error));
  };
  signal.addEventListener('abort', abortRun);
  try {
    const [batchRows] = await appPool.query<BatchRow[]>(
      `SELECT b.*, w.name AS workspace_name
       FROM scenario_experiment_batch b JOIN scenario_workspace w ON w.workspace_id = b.workspace_id
       WHERE b.batch_id = ?`,
      [batchId],
    );
    const batch = batchRows[0];
    if (!batch) return;
    const configuration = decodeJson(batch.configuration);
    const definition = decodeJson(batch.definition_snapshot);
    const source: Pick<StoredWorkspace, 'id' | 'revision' | 'contentHash' | 'definition'> = {
      id: batch.workspace_id,
      revision: Number(batch.revision),
      contentHash: batch.revision_hash,
      definition,
    };
    await appPool.query(
      'UPDATE scenario_experiment_batch SET status = ?, started_at = NOW(3) WHERE batch_id = ? AND status = ?',
      ['RUNNING', batchId, 'QUEUED'],
    );
    const [cellRows] = await appPool.query<CellRow[]>(
      'SELECT * FROM scenario_experiment_cell WHERE batch_id = ? ORDER BY cell_index',
      [batchId],
    );
    if (cellRows.length !== Number(batch.total_cells) || cellRows.length === 0) {
      throw new Error('The saved batch configuration does not match its persisted cell matrix.');
    }
    let completedCells = 0;
    for (const cell of cellRows) {
      if (signal.aborted) break;
      await appPool.query(
        `UPDATE scenario_experiment_cell SET status = 'RUNNING', started_at = NOW(3)
         WHERE batch_id = ? AND cell_index = ?`,
        [batchId, cell.cell_index],
      );
      const runConfiguration: RunConfiguration = {
        runMode: configuration.runMode,
        isolation: cell.isolation_level,
        concurrency: Number(cell.concurrency_level),
        trials: configuration.trials,
        seed: configuration.seed,
        timeoutMs: configuration.timeoutMs,
      };
      currentRunId = await queuePinnedRun(source, runConfiguration);
      activeBatchRuns.set(batchId, currentRunId);
      await appPool.query(
        'UPDATE scenario_experiment_cell SET run_id = ? WHERE batch_id = ? AND cell_index = ?',
        [currentRunId, batchId, cell.cell_index],
      );
      if (signal.aborted) abortRun();

      let run: Record<string, unknown> | null = null;
      while (!signal.aborted) {
        run = await getRun(currentRunId);
        if (!run) throw new Error(`Child run ${currentRunId} disappeared.`);
        if (run.status !== 'QUEUED' && run.status !== 'RUNNING') break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      run ??= await getRun(currentRunId);
      const runStatus = run?.status;
      const engineMismatch = typeof run?.engineVersion === 'string' && run.engineVersion !== batch.engine_version;
      const cellStatus: CellStatus = runStatus === 'COMPLETED' && !engineMismatch
        ? 'COMPLETED'
        : runStatus === 'CANCELLED' || signal.aborted
          ? 'CANCELLED'
          : 'FAILED';
      const runSummary = run?.summary ?? null;
      const trialsCompleted = numeric(runSummary, 'trials') ?? 0;
      const p50Ms = numeric(runSummary, 'p50Ms');
      const p95Ms = numeric(runSummary, 'p95Ms');
      const violations = numeric(runSummary, 'violations');
      const runError = engineMismatch
        ? `Engine version changed during batch (${batch.engine_version} → ${String(run?.engineVersion)}).`
        : typeof run?.error === 'string' ? run.error : null;
      await appPool.query(
        `UPDATE scenario_experiment_cell
         SET status = ?, trials_completed = ?, p50_ms = ?, p95_ms = ?, violations = ?, error_message = ?, finished_at = NOW(3)
         WHERE batch_id = ? AND cell_index = ?`,
        [cellStatus, trialsCompleted, p50Ms, p95Ms, violations, runError, batchId, cell.cell_index],
      );
      if (cellStatus === 'COMPLETED') completedCells += 1;
      await appPool.query(
        `UPDATE scenario_experiment_batch
         SET completed_cells = ?, finished_cells = finished_cells + 1
         WHERE batch_id = ?`,
        [completedCells, batchId],
      );
      activeBatchRuns.delete(batchId);
      currentRunId = undefined;
      if (cellStatus !== 'COMPLETED') break;
    }

    const wasCancelled = signal.aborted;
    if (wasCancelled || completedCells < cellRows.length) {
      const message = wasCancelled ? 'Batch cancelled; unfinished cells were not run.' : 'Batch stopped after a child run failed; remaining cells were not run.';
      await markRemainingCancelled(batchId, message);
    }
    const status: BatchStatus = wasCancelled
      ? 'CANCELLED'
      : completedCells === cellRows.length
        ? 'COMPLETED'
        : completedCells > 0
          ? 'PARTIAL'
          : 'FAILED';
    const error = status === 'PARTIAL' || status === 'FAILED'
      ? 'One or more configuration cells did not complete successfully.'
      : null;
    await appPool.query(
      'UPDATE scenario_experiment_batch SET status = ?, error_message = ?, finished_at = NOW(3) WHERE batch_id = ?',
      [status, error, batchId],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Experiment batch failed.';
    await markRemainingCancelled(batchId, 'Batch stopped after an internal error.');
    const [rows] = await appPool.query<Array<RowDataPacket & { completed_cells: number }>>(
      'SELECT completed_cells FROM scenario_experiment_batch WHERE batch_id = ?',
      [batchId],
    );
    const status: BatchStatus = Number(rows[0]?.completed_cells ?? 0) > 0 ? 'PARTIAL' : 'FAILED';
    await appPool.query(
      'UPDATE scenario_experiment_batch SET status = ?, error_message = ?, finished_at = NOW(3) WHERE batch_id = ?',
      [status, message.slice(0, 1000), batchId],
    );
  } finally {
    signal.removeEventListener('abort', abortRun);
    batchControllers.delete(batchId);
    activeBatchRuns.delete(batchId);
  }
}

export async function getExperimentBatch(batchId: string): Promise<Record<string, unknown> | null> {
  const [batchRows] = await appPool.query<BatchRow[]>(
    `SELECT b.*, w.name AS workspace_name
     FROM scenario_experiment_batch b JOIN scenario_workspace w ON w.workspace_id = b.workspace_id
     WHERE b.batch_id = ?`,
    [batchId],
  );
  const batch = batchRows[0];
  if (!batch) return null;
  const [cellRows] = await appPool.query<CellRow[]>(
    'SELECT * FROM scenario_experiment_cell WHERE batch_id = ? ORDER BY cell_index',
    [batchId],
  );
  return { ...batchSummary(batch), cells: cellRows.map(mapCell) };
}

export async function listExperimentBatches(workspaceId?: string): Promise<Array<Record<string, unknown>>> {
  const [rows] = await appPool.query<BatchRow[]>(
    `SELECT b.*, w.name AS workspace_name
     FROM scenario_experiment_batch b JOIN scenario_workspace w ON w.workspace_id = b.workspace_id
     WHERE (? IS NULL OR b.workspace_id = ?)
     ORDER BY b.created_at DESC LIMIT 50`,
    [workspaceId ?? null, workspaceId ?? null],
  );
  return rows.map(batchSummary);
}

export async function cancelExperimentBatch(batchId: string): Promise<{ cancelled: boolean; status?: BatchStatus }> {
  const [rows] = await appPool.query<Array<RowDataPacket & { status: BatchStatus }>>(
    'SELECT status FROM scenario_experiment_batch WHERE batch_id = ?',
    [batchId],
  );
  if (!rows[0]) return { cancelled: false };
  if (rows[0].status !== 'QUEUED' && rows[0].status !== 'RUNNING') {
    return { cancelled: false, status: rows[0].status };
  }
  const controller = batchControllers.get(batchId);
  if (controller) {
    controller.abort();
    const childRunId = activeBatchRuns.get(batchId);
    if (childRunId) await cancelRun(childRunId);
    return { cancelled: true, status: 'CANCELLED' };
  }
  return { cancelled: false, status: rows[0].status };
}
