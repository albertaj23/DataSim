import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { appPool, labPool } from '../../db/pool.js';
import {
  emptyWorkspaceDefinition,
  findTemplate,
  scenarioTemplates,
  validateWorkspaceDefinition,
  workspaceDefinitionSchema,
  workspaceHash,
  type Scalar,
  type WorkspaceDefinition,
  type WorkspaceOperation,
} from './schema.js';

interface WorkspaceRow extends RowDataPacket {
  workspace_id: string; name: string; description: string; current_revision: number;
  archived: number; created_at: Date; updated_at: Date; last_activity_at: Date;
}
interface RevisionRow extends RowDataPacket { revision: number; definition: WorkspaceDefinition; content_hash: string }
interface RunRow extends RowDataPacket {
  run_id: string; workspace_id: string; revision: number; revision_hash: string;
  definition_snapshot: WorkspaceDefinition; configuration: RunConfiguration; run_mode: string;
  engine: string; engine_version: string; status: string; seed: number;
  summary: unknown; error_message: string | null; created_at: Date; started_at: Date | null; finished_at: Date | null;
}
interface StateRow extends RowDataPacket { row_key: string; row_data: Record<string, Scalar> }

export interface RunConfiguration {
  runMode: 'LIVE_DBMS' | 'GUIDED_SCHEDULE';
  isolation: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  concurrency: number;
  trials: number;
  seed: number;
  timeoutMs: number;
}

const isolationLevels = ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'] as const;
const runModes = ['LIVE_DBMS', 'GUIDED_SCHEDULE'] as const;
const runConfigSchema = z.object({
  runMode: z.enum(runModes),
  isolation: z.enum(isolationLevels),
  concurrency: z.number().int().min(1).max(8).optional(),
  trials: z.number().int().min(1).max(10),
  seed: z.number().int().min(0).max(2_147_483_647),
  timeoutMs: z.number().int().min(2_000).max(30_000),
}).strict();

export interface WorkspaceSummary {
  id: string; name: string; description: string; revision: number; contentHash: string;
  archived: boolean; createdAt: string; updatedAt: string; lastActivityAt: string;
  runCount: number; latestRunStatus: string | null;
}

export interface StoredWorkspace extends WorkspaceSummary { definition: WorkspaceDefinition }

function jsonValue<T>(value: T | string): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSummary(row: WorkspaceRow & RowDataPacket): WorkspaceSummary {
  const extra = row as WorkspaceRow & RowDataPacket & { content_hash: string; run_count: number; latest_run_status: string | null };
  return {
    id: row.workspace_id, name: row.name, description: row.description, revision: Number(row.current_revision),
    contentHash: extra.content_hash, archived: Boolean(row.archived), createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at), lastActivityAt: timestamp(row.last_activity_at),
    runCount: Number(extra.run_count ?? 0), latestRunStatus: extra.latest_run_status ?? null,
  };
}

async function getWorkspaceRow(id: string): Promise<WorkspaceRow | undefined> {
  const [rows] = await appPool.query<WorkspaceRow[]>(
    `SELECT w.*, r.content_hash,
       (SELECT COUNT(*) FROM scenario_run sr WHERE sr.workspace_id = w.workspace_id) AS run_count,
       (SELECT sr.status FROM scenario_run sr WHERE sr.workspace_id = w.workspace_id ORDER BY sr.created_at DESC LIMIT 1) AS latest_run_status
     FROM scenario_workspace w
     JOIN scenario_revision r ON r.workspace_id = w.workspace_id AND r.revision = w.current_revision
     WHERE w.workspace_id = ?`,
    [id],
  );
  return rows[0];
}

async function createWorkspace(name: string, description: string, definition: WorkspaceDefinition): Promise<string> {
  const id = randomUUID();
  const contentHash = workspaceHash(definition);
  const connection = await appPool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      'INSERT INTO scenario_workspace (workspace_id, name, description, current_revision) VALUES (?, ?, ?, 1)',
      [id, name, description],
    );
    await connection.query(
      'INSERT INTO scenario_revision (workspace_id, revision, schema_version, definition, content_hash) VALUES (?, 1, 1, ?, ?)',
      [id, JSON.stringify(definition), contentHash],
    );
    await connection.commit();
    return id;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listWorkspaces(search: string, includeArchived: boolean): Promise<WorkspaceSummary[]> {
  const pattern = `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`;
  const [rows] = await appPool.query<Array<WorkspaceRow & RowDataPacket>>(
    `SELECT w.*, r.content_hash,
       (SELECT COUNT(*) FROM scenario_run sr WHERE sr.workspace_id = w.workspace_id) AS run_count,
       (SELECT sr.status FROM scenario_run sr WHERE sr.workspace_id = w.workspace_id ORDER BY sr.created_at DESC LIMIT 1) AS latest_run_status
     FROM scenario_workspace w
     JOIN scenario_revision r ON r.workspace_id = w.workspace_id AND r.revision = w.current_revision
     WHERE (? = 1 OR w.archived = FALSE) AND (? = '' OR w.name LIKE ? OR w.description LIKE ?)
     ORDER BY w.archived ASC, w.last_activity_at DESC`,
    [includeArchived ? 1 : 0, search.trim(), pattern, pattern],
  );
  return rows.map(toSummary);
}

export async function getWorkspace(id: string): Promise<StoredWorkspace | null> {
  const row = await getWorkspaceRow(id);
  if (!row) return null;
  const [revisions] = await appPool.query<RevisionRow[]>(
    'SELECT definition, content_hash FROM scenario_revision WHERE workspace_id = ? AND revision = ?',
    [id, row.current_revision],
  );
  const revision = revisions[0];
  if (!revision) throw new Error(`Workspace ${id} is missing its current revision.`);
  return { ...toSummary(row), definition: jsonValue(revision.definition) };
}

export async function createBlankWorkspace(name: string, description = ''): Promise<StoredWorkspace> {
  const id = await createWorkspace(name, description, emptyWorkspaceDefinition());
  const workspace = await getWorkspace(id);
  if (!workspace) throw new Error('Workspace creation completed but the new workspace could not be loaded.');
  return workspace;
}

export async function instantiateTemplate(templateId: string, name?: string): Promise<StoredWorkspace | null> {
  const template = findTemplate(templateId);
  if (!template) return null;
  const id = await createWorkspace(name?.trim() || template.title, template.description, template.definition);
  const workspace = await getWorkspace(id);
  if (!workspace) throw new Error('Template workspace was created but could not be loaded.');
  return workspace;
}

export async function patchWorkspaceMetadata(id: string, patch: { name?: string; description?: string }): Promise<StoredWorkspace | null> {
  const row = await getWorkspaceRow(id);
  if (!row || Boolean(row.archived)) return null;
  const values: unknown[] = [];
  const assignments: string[] = [];
  if (patch.name !== undefined) { assignments.push('name = ?'); values.push(patch.name.trim()); }
  if (patch.description !== undefined) { assignments.push('description = ?'); values.push(patch.description.trim()); }
  if (assignments.length) {
    assignments.push('last_activity_at = NOW(3)');
    values.push(id);
    await appPool.query(`UPDATE scenario_workspace SET ${assignments.join(', ')} WHERE workspace_id = ?`, values);
  }
  return getWorkspace(id);
}

export async function saveWorkspaceDefinition(id: string, input: unknown): Promise<StoredWorkspace | null> {
  const parsed = workspaceDefinitionSchema.safeParse(input);
  if (!parsed.success) return null;
  const definition = parsed.data;
  const contentHash = workspaceHash(definition);
  const connection = await appPool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<WorkspaceRow[]>(
      'SELECT * FROM scenario_workspace WHERE workspace_id = ? AND archived = FALSE FOR UPDATE',
      [id],
    );
    const workspace = rows[0];
    if (!workspace) { await connection.rollback(); return null; }
    const [current] = await connection.query<RevisionRow[]>(
      'SELECT definition, content_hash FROM scenario_revision WHERE workspace_id = ? AND revision = ?',
      [id, workspace.current_revision],
    );
    const currentRevision = current[0];
    if (!currentRevision) throw new Error(`Workspace ${id} is missing its current revision.`);
    if (currentRevision.content_hash !== contentHash) {
      const nextRevision = Number(workspace.current_revision) + 1;
      await connection.query(
        'INSERT INTO scenario_revision (workspace_id, revision, schema_version, definition, content_hash) VALUES (?, ?, 1, ?, ?)',
        [id, nextRevision, JSON.stringify(definition), contentHash],
      );
      await connection.query(
        'UPDATE scenario_workspace SET current_revision = ?, last_activity_at = NOW(3) WHERE workspace_id = ?',
        [nextRevision, id],
      );
    } else {
      await connection.query('UPDATE scenario_workspace SET last_activity_at = NOW(3) WHERE workspace_id = ?', [id]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getWorkspace(id);
}

export async function listRevisions(id: string): Promise<Array<{ revision: number; contentHash: string; createdAt: string }>> {
  const [rows] = await appPool.query<Array<RevisionRow & RowDataPacket & { created_at: Date }>>(
    'SELECT revision, content_hash, created_at FROM scenario_revision WHERE workspace_id = ? ORDER BY revision DESC',
    [id],
  );
  return rows.map((row) => ({ revision: Number(row.revision), contentHash: row.content_hash, createdAt: timestamp(row.created_at) }));
}

export async function archiveWorkspace(id: string): Promise<boolean> {
  const [result] = await appPool.query<ResultSetHeader>(
    'UPDATE scenario_workspace SET archived = TRUE, last_activity_at = NOW(3) WHERE workspace_id = ? AND archived = FALSE',
    [id],
  );
  return result.affectedRows > 0;
}

export async function restoreWorkspace(id: string): Promise<boolean> {
  const [result] = await appPool.query<ResultSetHeader>(
    'UPDATE scenario_workspace SET archived = FALSE, last_activity_at = NOW(3) WHERE workspace_id = ? AND archived = TRUE',
    [id],
  );
  return result.affectedRows > 0;
}

export async function duplicateWorkspace(id: string, name?: string): Promise<StoredWorkspace | null> {
  const source = await getWorkspace(id);
  if (!source) return null;
  const newId = await createWorkspace(name?.trim() || `${source.name} copy`, source.description, source.definition);
  const copy = await getWorkspace(newId);
  if (!copy) throw new Error('Workspace duplicate was created but could not be loaded.');
  return copy;
}

export async function validateWorkspace(id: string): Promise<{ valid: boolean; problems: Array<{ path: string; message: string }> } | null> {
  const workspace = await getWorkspace(id);
  if (!workspace) return null;
  const { problems } = validateWorkspaceDefinition(workspace.definition);
  return { valid: problems.length === 0, problems };
}

interface RunEvent {
  eventType: string;
  actorId?: string;
  source: 'DBMS_OBSERVED' | 'DATASIM_DERIVED' | 'MODELED';
  sql?: string;
  payload: Record<string, unknown>;
}

async function addRunEvent(runId: string, sequence: number, event: RunEvent): Promise<void> {
  await appPool.query(
    `INSERT INTO scenario_run_event (run_id, sequence_no, event_type, actor_id, observation_source, sql_text, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [runId, sequence, event.eventType, event.actorId ?? null, event.source, event.sql ?? null, JSON.stringify(event.payload)],
  );
}

function keyOf(value: Scalar): string {
  return JSON.stringify(value);
}

function decodeJson<T>(value: T | string): T {
  return jsonValue(value);
}

function byId<T extends { id: string }>(items: T[], id: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown model reference "${id}".`);
  return item;
}

function fieldPath(fieldId: string): string {
  return `$."${fieldId}"`;
}

class RunCancelledError extends Error {
  constructor() { super('Run cancelled.'); }
}

interface BarrierWaiter { arrived: Set<string>; resolve: () => void; promise: Promise<void> }

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new RunCancelledError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function cleanup() { clearTimeout(timer); signal.removeEventListener('abort', aborted); }
    function done() { cleanup(); resolve(); }
    function aborted() { cleanup(); reject(new RunCancelledError()); }
    signal.addEventListener('abort', aborted, { once: true });
  });
}

function createBarrier(participantIds: string[], signal: AbortSignal) {
  const waits = new Map<string, BarrierWaiter>();
  return async (name: string, actorId: string) => {
    if (signal.aborted) throw new RunCancelledError();
    let waiter = waits.get(name);
    if (!waiter) {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => { resolve = done; });
      waiter = { arrived: new Set(), resolve, promise };
      waits.set(name, waiter);
    }
    const barrier = waiter;
    barrier.arrived.add(actorId);
    if (barrier.arrived.size === participantIds.length) barrier.resolve();
    await new Promise<void>((resolve, reject) => {
      const aborted = () => { signal.removeEventListener('abort', aborted); reject(new RunCancelledError()); };
      signal.addEventListener('abort', aborted, { once: true });
      void barrier.promise.then(() => {
        signal.removeEventListener('abort', aborted);
        resolve();
      });
    });
  };
}

async function persistFixture(runId: string, trial: number, definition: WorkspaceDefinition): Promise<void> {
  const rows: Array<[string, string, string]> = [];
  for (const entity of definition.entities) {
    const primaryKey = entity.fields.find((field) => field.primaryKey);
    if (!primaryKey) throw new Error(`Table "${entity.name}" needs a primary key.`);
    for (const fixture of entity.fixtures) {
      const key = fixture[primaryKey.id];
      if (key === undefined || key === null) throw new Error(`Fixture in "${entity.name}" is missing its primary key.`);
      rows.push([entity.id, keyOf(key), JSON.stringify(fixture)]);
    }
  }
  for (const [entityId, rowKey, rowData] of rows) {
    await appPool.query(
      'INSERT INTO scenario_run_state (run_id, trial_no, entity_id, row_key, row_data) VALUES (?, ?, ?, ?, ?)',
      [runId, trial, entityId, rowKey, rowData],
    );
  }
  for (const entity of definition.entities) {
    for (const row of entity.fixtures) {
      const primaryKey = entity.fields.find((field) => field.primaryKey);
      if (!primaryKey) continue;
      const rowKey = keyOf(row[primaryKey.id]!);
      for (const field of entity.fields.filter((candidate) => candidate.unique)) {
        const value = row[field.id];
        if (value === undefined || value === null) continue;
        await registerUniqueValue(runId, trial, entity.id, field.id, value, rowKey);
      }
    }
  }
}

function valueHash(value: Scalar): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function registerUniqueValue(
  runId: string,
  trial: number,
  entityId: string,
  fieldId: string,
  value: Scalar,
  rowKey: string,
  connection?: PoolConnection,
): Promise<void> {
  const executor = connection ?? appPool;
  await executor.query(
    `INSERT INTO scenario_run_unique_value (run_id, trial_no, entity_id, field_id, value_hash, row_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [runId, trial, entityId, fieldId, valueHash(value), rowKey],
  );
}

async function refreshUniqueValues(
  connection: PoolConnection,
  runId: string,
  trial: number,
  entityId: string,
  rowKey: string,
  row: Record<string, Scalar>,
): Promise<void> {
  await connection.query(
    'DELETE FROM scenario_run_unique_value WHERE run_id = ? AND trial_no = ? AND entity_id = ? AND row_key = ?',
    [runId, trial, entityId, rowKey],
  );
  const definition = await getRunDefinition(runId);
  const entity = byId(definition.entities, entityId);
  for (const field of entity.fields.filter((candidate) => candidate.unique)) {
    const value = row[field.id];
    if (value !== undefined && value !== null) await registerUniqueValue(runId, trial, entityId, field.id, value, rowKey, connection);
  }
}

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY');
}

async function executeOperation(
  connection: PoolConnection,
  operation: WorkspaceOperation,
  runId: string,
  trial: number,
  actorId: string,
  variables: Map<string, Record<string, Scalar>>,
  signal: AbortSignal,
  event: (input: RunEvent) => Promise<void>,
): Promise<void> {
  if (signal.aborted) throw new RunCancelledError();
  const base = { runId, trial, actorId };
  if (operation.type === 'barrier') {
    await event({ ...base, eventType: 'schedule.barrier.wait', source: 'DATASIM_DERIVED', payload: { name: operation.name } });
    return;
  }
  if (operation.type === 'wait') {
    await event({ ...base, eventType: 'schedule.delay.started', source: 'DATASIM_DERIVED', payload: { durationMs: operation.durationMs } });
    await abortableDelay(operation.durationMs, signal);
    return;
  }
  if (operation.type === 'commit') {
    await connection.commit();
    await event({ ...base, eventType: 'transaction.committed', source: 'DBMS_OBSERVED', sql: 'COMMIT', payload: {} });
    return;
  }
  if (operation.type === 'rollback') {
    await connection.rollback();
    await event({ ...base, eventType: 'transaction.rolled_back', source: 'DBMS_OBSERVED', sql: 'ROLLBACK', payload: {} });
    return;
  }

  const entityId = operation.entityId;
  if (operation.type === 'read') {
    const sql = `SELECT row_data FROM scenario_run_state WHERE run_id = ? AND trial_no = ? AND entity_id = ? AND row_key = ?${operation.lock ? ' FOR UPDATE' : ''}`;
    const [rows] = await connection.query<StateRow[]>(sql, [runId, trial, entityId, keyOf(operation.key)]);
    const row = rows[0];
    if (!row) throw new Error(`Read found no fixture row in "${entityId}" for key ${String(operation.key)}.`);
    const data = decodeJson(row.row_data);
    variables.set(operation.as, data);
    await event({
      ...base, eventType: 'read.completed', source: 'DBMS_OBSERVED', sql,
      payload: { entityId, key: operation.key, row: data, lock: operation.lock, variable: operation.as },
    });
    return;
  }

  if (operation.type === 'insert') {
    const entity = (await getRunDefinition(runId)).entities.find((candidate) => candidate.id === entityId);
    if (!entity) throw new Error(`Insert refers to unknown table "${entityId}".`);
    const keyField = entity?.fields.find((field) => field.primaryKey);
    const primaryKey = keyField ? operation.values[keyField.id] : undefined;
    if (primaryKey === undefined || primaryKey === null) throw new Error(`Insert into "${entityId}" needs its primary key.`);
    const sql = 'INSERT INTO scenario_run_state (run_id, trial_no, entity_id, row_key, row_data) VALUES (?, ?, ?, ?, ?)';
    await connection.query('SAVEPOINT scenario_operation');
    try {
      await connection.query(sql, [runId, trial, entityId, keyOf(primaryKey), JSON.stringify(operation.values)]);
      for (const field of entity.fields.filter((candidate) => candidate.unique)) {
        const value = operation.values[field.id];
        if (value !== undefined && value !== null) await registerUniqueValue(runId, trial, entityId, field.id, value, keyOf(primaryKey), connection);
      }
      await connection.query('RELEASE SAVEPOINT scenario_operation');
    } catch (error) {
      await connection.query('ROLLBACK TO SAVEPOINT scenario_operation');
      await connection.query('RELEASE SAVEPOINT scenario_operation');
      if (!isDuplicateKey(error)) throw error;
      await event({ ...base, eventType: 'constraint.rejected', source: 'DBMS_OBSERVED', sql, payload: { entityId, key: primaryKey, constraint: 'PRIMARY OR UNIQUE KEY' } });
      return;
    }
    await event({ ...base, eventType: 'write.inserted', source: 'DBMS_OBSERVED', sql, payload: { entityId, key: primaryKey, row: operation.values } });
    return;
  }

  if (operation.type === 'delete') {
    const sql = 'DELETE FROM scenario_run_state WHERE run_id = ? AND trial_no = ? AND entity_id = ? AND row_key = ?';
    const [result] = await connection.query<ResultSetHeader>(sql, [runId, trial, entityId, keyOf(operation.key)]);
    if (result.affectedRows) await connection.query(
      'DELETE FROM scenario_run_unique_value WHERE run_id = ? AND trial_no = ? AND entity_id = ? AND row_key = ?',
      [runId, trial, entityId, keyOf(operation.key)],
    );
    await event({ ...base, eventType: 'write.deleted', source: 'DBMS_OBSERVED', sql, payload: { entityId, key: operation.key, affectedRows: result.affectedRows } });
    return;
  }

  const expressionSql: string[] = [];
  const params: unknown[] = [];
  for (const change of operation.changes) {
    const path = fieldPath(change.fieldId);
    expressionSql.push('?');
    params.push(path);
    if (change.value.kind === 'increment') {
      expressionSql.push("COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(row_data, ?)) AS DECIMAL(20,6)), 0) + ?");
      params.push(path, change.value.amount);
    } else {
      const value = change.value.kind === 'literal'
        ? change.value.value
        : variables.get(change.value.variable)?.[change.value.fieldId];
      if (value === undefined) throw new Error(`Actor "${actorId}" has no saved value for "${change.value.kind === 'literal' ? '' : change.value.variable}.${change.value.kind === 'literal' ? '' : change.value.fieldId}".`);
      if (change.value.kind === 'read-field' && change.value.offset !== undefined) {
        if (typeof value !== 'number') throw new Error('A numeric read offset requires a numeric value from the selected row.');
        const adjusted = value + change.value.offset;
        const entity = (await getRunDefinition(runId)).entities.find((candidate) => candidate.id === entityId);
        const field = entity?.fields.find((candidate) => candidate.id === change.fieldId);
        if (!Number.isFinite(adjusted) || (field?.type === 'INTEGER' && !Number.isInteger(adjusted))) {
          throw new Error(`The numeric read offset does not produce a valid ${field?.type ?? 'number'} value.`);
        }
        expressionSql.push('CAST(? AS JSON)');
        params.push(JSON.stringify(adjusted));
        continue;
      }
      expressionSql.push('CAST(? AS JSON)');
      params.push(JSON.stringify(value));
    }
  }
  let sql = `UPDATE scenario_run_state SET row_data = JSON_SET(row_data, ${expressionSql.join(', ')}) WHERE run_id = ? AND trial_no = ? AND entity_id = ? AND row_key = ?`;
  params.push(runId, trial, entityId, keyOf(operation.key));
  if (operation.guard) {
    sql += ' AND CAST(JSON_UNQUOTE(JSON_EXTRACT(row_data, ?)) AS DECIMAL(20,6)) < CAST(JSON_UNQUOTE(JSON_EXTRACT(row_data, ?)) AS DECIMAL(20,6))';
    params.push(fieldPath(operation.guard.leftFieldId), fieldPath(operation.guard.rightFieldId));
  }
  await connection.query('SAVEPOINT scenario_operation');
  let result: ResultSetHeader;
  try {
    const [updated] = await connection.query<ResultSetHeader>(sql, params);
    result = updated;
    if (result.affectedRows) {
      const [rows] = await connection.query<StateRow[]>(
        'SELECT row_data FROM scenario_run_state WHERE run_id = ? AND trial_no = ? AND entity_id = ? AND row_key = ?',
        [runId, trial, entityId, keyOf(operation.key)],
      );
      if (rows[0]) await refreshUniqueValues(connection, runId, trial, entityId, keyOf(operation.key), decodeJson(rows[0].row_data));
    }
    await connection.query('RELEASE SAVEPOINT scenario_operation');
  } catch (error) {
    await connection.query('ROLLBACK TO SAVEPOINT scenario_operation');
    await connection.query('RELEASE SAVEPOINT scenario_operation');
    if (!isDuplicateKey(error)) throw error;
    await event({ ...base, eventType: 'constraint.rejected', source: 'DBMS_OBSERVED', sql, payload: { entityId, key: operation.key, constraint: 'UNIQUE KEY' } });
    return;
  }
  await event({
    ...base, eventType: result.affectedRows ? 'write.updated' : 'write.rejected',
    source: 'DBMS_OBSERVED', sql,
    payload: { entityId, key: operation.key, affectedRows: result.affectedRows, guarded: Boolean(operation.guard), changes: operation.changes },
  });
}

const runDefinitions = new Map<string, WorkspaceDefinition>();
async function getRunDefinition(runId: string): Promise<WorkspaceDefinition> {
  const cached = runDefinitions.get(runId);
  if (cached) return cached;
  const [rows] = await appPool.query<Array<RunRow & RowDataPacket>>('SELECT definition_snapshot FROM scenario_run WHERE run_id = ?', [runId]);
  if (!rows[0]) throw new Error(`Run ${runId} was not found.`);
  const definition = decodeJson(rows[0].definition_snapshot);
  runDefinitions.set(runId, definition);
  return definition;
}

async function evaluateInvariants(runId: string, trial: number, definition: WorkspaceDefinition): Promise<Array<{ id: string; description: string; passed: boolean; failures: string[] }>> {
  const results = [];
  for (const invariant of definition.invariants) {
    const [rows] = await appPool.query<StateRow[]>(
      'SELECT row_key, row_data FROM scenario_run_state WHERE run_id = ? AND trial_no = ? AND entity_id = ? ORDER BY row_key',
      [runId, trial, invariant.entityId],
    );
    const failures: string[] = [];
    for (const row of rows) {
      const data = decodeJson(row.row_data);
      if (invariant.kind === 'row-field-nonnegative') {
        const value = data[invariant.fieldId];
        if (typeof value !== 'number' || value < 0) failures.push(`${row.row_key}: ${invariant.fieldId}=${String(value)}`);
      } else if (invariant.kind === 'row-field-equals') {
        const value = data[invariant.fieldId];
        if (typeof value !== 'number' || value !== invariant.value) failures.push(`${row.row_key}: ${invariant.fieldId}=${String(value)}; expected ${invariant.value}`);
      } else {
        const left = data[invariant.leftFieldId];
        const right = data[invariant.rightFieldId];
        if (typeof left !== 'number' || typeof right !== 'number' || left > right) {
          failures.push(`${row.row_key}: ${invariant.leftFieldId}=${String(left)} exceeds ${invariant.rightFieldId}=${String(right)}`);
        }
      }
    }
    results.push({ id: invariant.id, description: invariant.description, passed: failures.length === 0, failures });
  }
  return results;
}

async function runTrial(
  runId: string,
  trial: number,
  definition: WorkspaceDefinition,
  configuration: RunConfiguration,
  signal: AbortSignal,
  abortRun: () => void,
  nextSequence: () => number,
): Promise<{
  trial: number;
  durationMs: number;
  invariants: Awaited<ReturnType<typeof evaluateInvariants>>;
  finalState: Record<string, Record<string, Record<string, Scalar>>>;
}> {
  await persistFixture(runId, trial, definition);
  await addRunEvent(runId, nextSequence(), { eventType: 'trial.started', source: 'DATASIM_DERIVED', payload: { trial, seed: configuration.seed } });
  const activeActors = definition.actors.slice(0, configuration.concurrency);
  const participants = activeActors.map((actor) => actor.id);
  const waitAtBarrier = createBarrier(participants, signal);
  const start = performance.now();
  const actors = activeActors.map(async (actor) => {
    const connection = await labPool.getConnection();
    const variables = new Map<string, Record<string, Scalar>>();
    let inTransaction = false;
    let originalLockWait = 50;
    const emit = (input: RunEvent) => addRunEvent(runId, nextSequence(), input);
    try {
      const [settings] = await connection.query<Array<RowDataPacket & { value: number }>>('SELECT @@SESSION.innodb_lock_wait_timeout AS value');
      originalLockWait = Number(settings[0]?.value ?? 50);
      if (!Number.isSafeInteger(originalLockWait) || originalLockWait < 1) throw new Error('Could not read the connection lock-wait timeout.');
      await connection.query(`SET TRANSACTION ISOLATION LEVEL ${configuration.isolation}`);
      await connection.query('SET SESSION innodb_lock_wait_timeout = 5');
      await connection.beginTransaction();
      inTransaction = true;
      await emit({ eventType: 'transaction.started', actorId: actor.id, source: 'DBMS_OBSERVED', sql: 'START TRANSACTION', payload: { isolation: configuration.isolation } });
      for (const operation of actor.operations) {
        if (signal.aborted) throw new RunCancelledError();
        if (operation.type === 'barrier') {
          await waitAtBarrier(operation.name, actor.id);
          await emit({ eventType: 'schedule.barrier.released', actorId: actor.id, source: 'DATASIM_DERIVED', payload: { name: operation.name } });
        } else {
          await executeOperation(connection, operation, runId, trial, actor.id, variables, signal, emit);
          if (operation.type === 'commit' || operation.type === 'rollback') inTransaction = false;
        }
      }
      if (inTransaction) {
        await connection.commit();
        inTransaction = false;
        await emit({ eventType: 'transaction.committed', actorId: actor.id, source: 'DBMS_OBSERVED', sql: 'COMMIT', payload: { implicit: true } });
      }
    } catch (error) {
      abortRun();
      if (inTransaction) await connection.rollback();
      const message = error instanceof Error ? error.message : 'Database operation failed.';
      await emit({ eventType: 'transaction.aborted', actorId: actor.id, source: 'DBMS_OBSERVED', sql: 'ROLLBACK', payload: { error: message } });
      throw error;
    } finally {
      try {
        await connection.query('SET SESSION innodb_lock_wait_timeout = ?', [originalLockWait]);
        connection.release();
      } catch (error) {
        connection.destroy();
        throw error;
      }
    }
  });
  const outcomes = await Promise.allSettled(actors);
  const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
  if (rejected) throw rejected.reason;
  if (signal.aborted) throw new RunCancelledError();
  const invariants = await evaluateInvariants(runId, trial, definition);
  const finalState: Record<string, Record<string, Record<string, Scalar>>> = {};
  for (const entity of definition.entities) {
    const [rows] = await appPool.query<StateRow[]>(
      'SELECT row_key, row_data FROM scenario_run_state WHERE run_id = ? AND trial_no = ? AND entity_id = ? ORDER BY row_key',
      [runId, trial, entity.id],
    );
    finalState[entity.id] = Object.fromEntries(rows.map((row) => [row.row_key, decodeJson(row.row_data)]));
  }
  const durationMs = Math.round(performance.now() - start);
  await addRunEvent(runId, nextSequence(), {
    eventType: 'invariant.evaluated', source: 'DATASIM_DERIVED',
    payload: { trial, invariants, finalState, durationMs, runMode: configuration.runMode },
  });
  return { trial, durationMs, invariants, finalState };
}

const controllers = new Map<string, AbortController>();
const runningDefinitions = new Map<string, WorkspaceDefinition>();

type TrialOutcome = Awaited<ReturnType<typeof runTrial>>;

function summarizeTrials(trials: TrialOutcome[], configuration: RunConfiguration, partial: boolean) {
  const durations = trials.map((trial) => trial.durationMs).sort((left, right) => left - right);
  const invariantResults = trials.flatMap((trial) => trial.invariants);
  return {
    runMode: configuration.runMode,
    concurrency: configuration.concurrency,
    revisionPinned: true,
    partial,
    trials: trials.length,
    invariantChecks: invariantResults.length,
    violations: invariantResults.filter((result) => !result.passed).length,
    invariants: invariantResults,
    durationMs: trials.reduce((sum, trial) => sum + trial.durationMs, 0),
    p50Ms: durations[Math.floor((durations.length - 1) * 0.5)] ?? null,
    p95Ms: durations[Math.ceil(durations.length * 0.95) - 1] ?? null,
    outcomes: trials,
  };
}

async function executeRun(runId: string, definition: WorkspaceDefinition, configuration: RunConfiguration, signal: AbortSignal): Promise<void> {
  runDefinitions.set(runId, definition);
  let sequence = 0;
  const nextSequence = () => ++sequence;
  const startedAt = new Date();
  const trials: TrialOutcome[] = [];
  try {
    const [versionRows] = await appPool.query<Array<RowDataPacket & { version: string }>>('SELECT VERSION() AS version');
    await appPool.query(
      'UPDATE scenario_run SET status = ?, started_at = NOW(3), engine_version = ? WHERE run_id = ?',
      ['RUNNING', versionRows[0]?.version ?? 'unknown', runId],
    );
    await addRunEvent(runId, nextSequence(), {
      eventType: 'run.started', source: 'DATASIM_DERIVED',
      payload: { runMode: configuration.runMode, concurrency: configuration.concurrency, engine: 'MySQL/InnoDB', engineVersion: versionRows[0]?.version ?? 'unknown', startedAt: startedAt.toISOString() },
    });
    for (let trial = 1; trial <= configuration.trials; trial += 1) {
      if (signal.aborted) throw new RunCancelledError();
      trials.push(await runTrial(runId, trial, definition, configuration, signal, () => {
        const controller = controllers.get(runId);
        if (controller && !controller.signal.aborted) controller.abort();
      }, nextSequence));
    }
    const summary = summarizeTrials(trials, configuration, false);
    await appPool.query('UPDATE scenario_run SET status = ?, summary = ?, finished_at = NOW(3) WHERE run_id = ?', ['COMPLETED', JSON.stringify(summary), runId]);
    await addRunEvent(runId, nextSequence(), { eventType: 'run.completed', source: 'DATASIM_DERIVED', payload: { status: 'COMPLETED', violations: summary.violations, trials: summary.trials } });
  } catch (error) {
    const cancelled = signal.aborted || error instanceof RunCancelledError;
    const message = cancelled ? 'Run cancelled; open transactions were rolled back.' : error instanceof Error ? error.message : 'Run failed.';
    const status = cancelled ? 'CANCELLED' : 'FAILED';
    const partialSummary = trials.length ? summarizeTrials(trials, configuration, true) : null;
    await appPool.query(
      'UPDATE scenario_run SET status = ?, summary = ?, error_message = ?, finished_at = NOW(3) WHERE run_id = ?',
      [status, partialSummary ? JSON.stringify(partialSummary) : null, message.slice(0, 1000), runId],
    );
    await addRunEvent(runId, nextSequence(), { eventType: `run.${status.toLowerCase()}`, source: 'DATASIM_DERIVED', payload: { status, error: message } });
  } finally {
    controllers.delete(runId);
    runningDefinitions.delete(runId);
    runDefinitions.delete(runId);
  }
}

type RunSource = Pick<StoredWorkspace, 'id' | 'revision' | 'contentHash' | 'definition'>;

export async function queuePinnedRun(workspace: RunSource, configuration: RunConfiguration): Promise<string> {
  const runId = randomUUID();
  const [versionRows] = await appPool.query<Array<RowDataPacket & { version: string }>>('SELECT VERSION() AS version');
  await appPool.query(
    `INSERT INTO scenario_run
       (run_id, workspace_id, revision, revision_hash, definition_snapshot, configuration,
        run_mode, engine, engine_version, status, seed)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'MySQL/InnoDB', ?, 'QUEUED', ?)`,
    [
      runId, workspace.id, workspace.revision, workspace.contentHash, JSON.stringify(workspace.definition),
      JSON.stringify(configuration), configuration.runMode, versionRows[0]?.version ?? 'unknown', configuration.seed,
    ],
  );
  const controller = new AbortController();
  controllers.set(runId, controller);
  runningDefinitions.set(runId, workspace.definition);
  const timeout = setTimeout(() => controller.abort(), configuration.timeoutMs);
  setImmediate(() => {
    void executeRun(runId, workspace.definition, configuration, controller.signal)
      .finally(() => clearTimeout(timeout))
      .catch((error: unknown) => console.error(`Run ${runId} could not be finalized:`, error));
  });
  return runId;
}

export async function startRun(workspaceId: string, configurationInput: unknown): Promise<{ runId: string; status: string; revision: number; revisionHash: string } | { error: 'NOT_FOUND' | 'VALIDATION' | 'BAD_CONFIGURATION'; problems?: Array<{ path: string; message: string }> }> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace || workspace.archived) return { error: 'NOT_FOUND' };
  const validation = validateWorkspaceDefinition(workspace.definition);
  if (!validation.definition) return { error: 'VALIDATION', problems: validation.problems };
  const parsedConfig = runConfigSchema.safeParse(configurationInput);
  if (!parsedConfig.success) {
    return { error: 'BAD_CONFIGURATION', problems: parsedConfig.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) };
  }
  const configuration = { ...parsedConfig.data, concurrency: parsedConfig.data.concurrency ?? validation.definition.actors.length } as RunConfiguration;
  if (configuration.concurrency > validation.definition.actors.length) {
    return { error: 'BAD_CONFIGURATION', problems: [{ path: 'concurrency', message: `Concurrency cannot exceed the ${validation.definition.actors.length} configured actor lane(s).` }] };
  }
  const runId = await queuePinnedRun(workspace, configuration);
  return { runId, status: 'QUEUED', revision: workspace.revision, revisionHash: workspace.contentHash };
}

export async function cancelRun(runId: string): Promise<{ cancelled: boolean; status?: string }> {
  const controller = controllers.get(runId);
  if (controller) {
    controller.abort();
    return { cancelled: true, status: 'CANCELLED' };
  }
  const [rows] = await appPool.query<Array<RowDataPacket & { status: string }>>('SELECT status FROM scenario_run WHERE run_id = ?', [runId]);
  if (!rows[0]) return { cancelled: false };
  return { cancelled: false, status: rows[0].status };
}

export async function listRuns(workspaceId?: string): Promise<Array<Record<string, unknown>>> {
  const [rows] = await appPool.query<Array<RunRow & RowDataPacket>>(
    `SELECT run_id, workspace_id, revision, revision_hash, configuration, run_mode, engine, engine_version,
       status, seed, summary, error_message, created_at, started_at, finished_at
     FROM scenario_run WHERE (? IS NULL OR workspace_id = ?) ORDER BY created_at DESC LIMIT 100`,
    [workspaceId ?? null, workspaceId ?? null],
  );
  return rows.map((row) => ({
    id: row.run_id, workspaceId: row.workspace_id, revision: Number(row.revision), revisionHash: row.revision_hash,
    configuration: jsonValue(row.configuration), runMode: row.run_mode, engine: row.engine, engineVersion: row.engine_version,
    status: row.status, seed: Number(row.seed), summary: row.summary ? jsonValue(row.summary) : null,
    error: row.error_message, createdAt: timestamp(row.created_at), startedAt: row.started_at ? timestamp(row.started_at) : null,
    finishedAt: row.finished_at ? timestamp(row.finished_at) : null,
  }));
}

export async function getRun(runId: string): Promise<Record<string, unknown> | null> {
  const [rows] = await appPool.query<Array<RunRow & RowDataPacket>>(
    `SELECT run_id, workspace_id, revision, revision_hash, configuration, run_mode, engine, engine_version,
       status, seed, summary, error_message, created_at, started_at, finished_at
     FROM scenario_run WHERE run_id = ?`,
    [runId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.run_id, workspaceId: row.workspace_id, revision: Number(row.revision), revisionHash: row.revision_hash,
    configuration: jsonValue(row.configuration), runMode: row.run_mode, engine: row.engine, engineVersion: row.engine_version,
    status: row.status, seed: Number(row.seed), summary: row.summary ? jsonValue(row.summary) : null,
    error: row.error_message, createdAt: timestamp(row.created_at), startedAt: row.started_at ? timestamp(row.started_at) : null,
    finishedAt: row.finished_at ? timestamp(row.finished_at) : null,
  };
}

export async function getRunEvents(runId: string): Promise<Array<Record<string, unknown>> | null> {
  if (!(await getRun(runId))) return null;
  const [rows] = await appPool.query<Array<RowDataPacket & {
    sequence_no: number; event_type: string; actor_id: string | null; observation_source: string;
    occurred_at: Date; sql_text: string | null; payload: unknown;
  }>>(
    'SELECT sequence_no, event_type, actor_id, observation_source, occurred_at, sql_text, payload FROM scenario_run_event WHERE run_id = ? ORDER BY sequence_no',
    [runId],
  );
  return rows.map((row) => ({
    sequence: Number(row.sequence_no), type: row.event_type, actorId: row.actor_id,
    source: row.observation_source, at: timestamp(row.occurred_at), sql: row.sql_text,
    payload: jsonValue(row.payload),
  }));
}

export async function getRunSnapshot(runId: string): Promise<Record<string, unknown> | null> {
  const [rows] = await appPool.query<Array<RunRow & RowDataPacket>>(
    'SELECT definition_snapshot, configuration, revision, revision_hash FROM scenario_run WHERE run_id = ?',
    [runId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    definition: jsonValue(row.definition_snapshot), configuration: jsonValue(row.configuration),
    revision: Number(row.revision), revisionHash: row.revision_hash,
  };
}

export function getScenarioTemplates() {
  return [
    { id: 'blank', title: 'Blank workspace', description: 'Start with a small editable table, then configure your own concurrent transactions.' },
    ...scenarioTemplates.map(({ id, title, description }) => ({ id, title, description })),
  ];
}

export function hasActiveRun(runId: string): boolean {
  return controllers.has(runId) && runningDefinitions.has(runId);
}

export { runConfigSchema, scenarioTemplates, findTemplate };
