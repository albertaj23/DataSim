import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DesignDoc, emptyDesign } from '@datasim/shared';
import type { FindingFix, ProjectDetail, ProjectSummary, RevisionInfo, RunKind, RunStatus } from '@datasim/shared';
import { appPool } from '../db/pool.js';
import { ServiceError } from '../services/liveStrategy.js';

const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();
const parseJson = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);
const parseDesign = (v: unknown): DesignDoc => DesignDoc.parse(parseJson(v));

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, canonical(x)]));
  }
  return v;
}
/** sha256 of the key-sorted JSON of the zod-parsed design. */
export const contentHash = (design: DesignDoc): string => createHash('sha256').update(JSON.stringify(canonical(DesignDoc.parse(design)))).digest('hex');

async function tx<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  const c = await appPool.getConnection();
  try {
    await c.query('START TRANSACTION');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
}

const notFound = () => new ServiceError(404, 'NOT_FOUND', 'Project not found');

// ---------------------------------------------------------------- projects
const SUMMARY_SQL = `
  SELECT p.project_id, p.name, p.description, p.template_key, p.created_at, p.updated_at, p.archived_at,
         (SELECT MAX(r.revision_no) FROM design_revision r WHERE r.project_id = p.project_id) AS latest_rev,
         lr.run_id AS lr_id, lr.slo_pass AS lr_slo, lr.p95_ms AS lr_p95, lr.status AS lr_status, lr.kind AS lr_kind
    FROM project p
    LEFT JOIN run lr ON lr.run_id = (SELECT x.run_id FROM run x WHERE x.project_id = p.project_id AND x.kind <> 'STRATEGY_CHILD' ORDER BY x.created_at DESC LIMIT 1)`;

function toSummary(r: RowDataPacket): ProjectSummary {
  return {
    projectId: r.project_id, name: r.name, description: r.description, templateKey: r.template_key,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), archivedAt: r.archived_at ? iso(r.archived_at) : null,
    latestRevisionNo: r.latest_rev ?? null,
    lastRun: r.lr_id ? { runId: r.lr_id, sloPass: r.lr_slo === null ? null : !!r.lr_slo, p95Ms: Number(r.lr_p95), status: r.lr_status as RunStatus, kind: r.lr_kind as RunKind } : null,
  };
}

export async function listProjects(opts: { includeArchived?: boolean } = {}): Promise<ProjectSummary[]> {
  const [rows] = await appPool.query<RowDataPacket[]>(`${SUMMARY_SQL} ${opts.includeArchived ? '' : 'WHERE p.archived_at IS NULL'} ORDER BY p.updated_at DESC`);
  return rows.map(toSummary);
}

export async function getProjectSummary(projectId: string): Promise<ProjectSummary | null> {
  const [rows] = await appPool.query<RowDataPacket[]>(`${SUMMARY_SQL} WHERE p.project_id = ?`, [projectId]);
  return rows[0] ? toSummary(rows[0]) : null;
}

export async function getProject(projectId: string): Promise<ProjectDetail | null> {
  const summary = await getProjectSummary(projectId);
  if (!summary) return null;
  const [d] = await appPool.query<RowDataPacket[]>('SELECT design_json, updated_at FROM project_draft WHERE project_id = ?', [projectId]);
  const design = d[0] ? parseDesign(d[0].design_json) : emptyDesign();
  const [r] = await appPool.query<RowDataPacket[]>('SELECT revision_no, content_hash FROM design_revision WHERE project_id = ? ORDER BY revision_no DESC LIMIT 1', [projectId]);
  return {
    ...summary, design, draftUpdatedAt: d[0] ? iso(d[0].updated_at) : summary.updatedAt,
    pinnedRevisionNo: r[0]?.revision_no ?? null, dirty: !r[0] || r[0].content_hash !== contentHash(design),
  };
}

export async function createProjectFromDesign(name: string, design: DesignDoc, opts: { description?: string; templateKey?: string | null; projectId?: string; archived?: boolean } = {}): Promise<string> {
  const doc = DesignDoc.parse(design);
  const id = opts.projectId ?? randomUUID();
  await tx(async (c) => {
    await c.query(`INSERT INTO project (project_id, name, description, template_key, archived_at) VALUES (?, ?, ?, ?, ${opts.archived ? 'NOW(3)' : 'NULL'})`, [id, name.slice(0, 120), (opts.description ?? '').slice(0, 500), opts.templateKey ?? null]);
    await c.query('INSERT INTO project_draft (project_id, design_json) VALUES (?, ?)', [id, JSON.stringify(doc)]);
  });
  return id;
}

export async function updateProject(projectId: string, patch: { name?: string; description?: string }): Promise<ProjectSummary> {
  const sets: string[] = []; const vals: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name.slice(0, 120)); }
  if (patch.description !== undefined) { sets.push('description = ?'); vals.push(patch.description.slice(0, 500)); }
  if (sets.length) {
    const [res] = await appPool.query<ResultSetHeader>(`UPDATE project SET ${sets.join(', ')} WHERE project_id = ?`, [...vals, projectId]);
    if (res.affectedRows === 0 && !(await getProjectSummary(projectId))) throw notFound();
  }
  const s = await getProjectSummary(projectId);
  if (!s) throw notFound();
  return s;
}

export async function archiveProject(projectId: string): Promise<void> {
  const [res] = await appPool.query<ResultSetHeader>('UPDATE project SET archived_at = COALESCE(archived_at, NOW(3)) WHERE project_id = ?', [projectId]);
  if (res.affectedRows === 0 && !(await getProjectSummary(projectId))) throw notFound();
}

/** Fork: copies the current draft into a new project named "<name> (fork)". */
export async function duplicateProject(projectId: string): Promise<string> {
  const p = await getProjectSummary(projectId);
  if (!p) throw notFound();
  return createProjectFromDesign(`${p.name} (fork)`, await getDraft(projectId), { description: p.description });
}

// ---------------------------------------------------------------- draft
export async function getDraft(projectId: string): Promise<DesignDoc> {
  const [rows] = await appPool.query<RowDataPacket[]>('SELECT design_json FROM project_draft WHERE project_id = ?', [projectId]);
  if (!rows[0]) throw notFound();
  return parseDesign(rows[0].design_json);
}

export async function saveDraft(projectId: string, design: DesignDoc): Promise<{ updatedAt: string }> {
  const doc = DesignDoc.parse(design);
  await appPool.query('UPDATE project SET updated_at = NOW(3) WHERE project_id = ?', [projectId]);
  const [res] = await appPool.query<ResultSetHeader>('UPDATE project_draft SET design_json = ?, updated_at = NOW(3) WHERE project_id = ?', [JSON.stringify(doc), projectId]);
  if (res.affectedRows === 0) throw notFound();
  const [rows] = await appPool.query<RowDataPacket[]>('SELECT updated_at FROM project_draft WHERE project_id = ?', [projectId]);
  return { updatedAt: iso(rows[0]!.updated_at) };
}

// ---------------------------------------------------------------- revisions
/** Pins the draft as an immutable revision. Reuses an existing revision when the content hash is unchanged. */
export async function pinCurrent(projectId: string, note = ''): Promise<{ revisionNo: number; design: DesignDoc; created: boolean }> {
  return tx(async (c) => {
    const [p] = await c.query<RowDataPacket[]>('SELECT project_id FROM project WHERE project_id = ? FOR UPDATE', [projectId]);
    if (!p[0]) throw notFound();
    const [d] = await c.query<RowDataPacket[]>('SELECT design_json FROM project_draft WHERE project_id = ?', [projectId]);
    const design = parseDesign(d[0]!.design_json);
    const hash = contentHash(design);
    // (project_id, content_hash) is unique, so an A -> B -> A edit also reuses the old revision.
    const [same] = await c.query<RowDataPacket[]>('SELECT revision_no FROM design_revision WHERE project_id = ? AND content_hash = ? ORDER BY revision_no DESC LIMIT 1', [projectId, hash]);
    if (same[0]) return { revisionNo: same[0].revision_no as number, design, created: false };
    const [m] = await c.query<RowDataPacket[]>('SELECT COALESCE(MAX(revision_no), 0) + 1 AS n FROM design_revision WHERE project_id = ?', [projectId]);
    const revisionNo = Number(m[0]!.n);
    await c.query('INSERT INTO design_revision (project_id, revision_no, design_json, content_hash, note) VALUES (?, ?, ?, ?, ?)', [projectId, revisionNo, JSON.stringify(design), hash, note.slice(0, 200)]);
    return { revisionNo, design, created: true };
  });
}

export async function getRevision(projectId: string, revisionNo: number): Promise<{ revisionNo: number; design: DesignDoc; contentHash: string; createdAt: string } | null> {
  const [rows] = await appPool.query<RowDataPacket[]>('SELECT revision_no, design_json, content_hash, created_at FROM design_revision WHERE project_id = ? AND revision_no = ?', [projectId, revisionNo]);
  const r = rows[0];
  return r ? { revisionNo: r.revision_no, design: parseDesign(r.design_json), contentHash: r.content_hash, createdAt: iso(r.created_at) } : null;
}

export async function listRevisions(projectId: string): Promise<RevisionInfo[]> {
  const [rows] = await appPool.query<RowDataPacket[]>('SELECT revision_no, content_hash, note, created_at FROM design_revision WHERE project_id = ? ORDER BY revision_no DESC', [projectId]);
  return rows.map((r) => ({ revisionNo: r.revision_no, contentHash: r.content_hash, note: r.note, createdAt: iso(r.created_at) }));
}

// ---------------------------------------------------------------- advisor fixes
const bad = (message: string) => new ServiceError(400, 'BAD_FIX', message);

/** Pure: returns the design with the fix applied, plus a default revision note. */
export function applyFixToDesign(design: DesignDoc, fix: FindingFix): { design: DesignDoc; note: string } {
  const d = structuredClone(design);
  const table = (name: string) => d.schema.tables.find((t) => t.name === name) ?? (() => { throw bad(`Unknown table ${name}`); })();
  const apps = d.nodes.flatMap((n) => (n.type === 'app' ? [n] : []));
  if (fix.type !== 'ADD_INDEX' && fix.type !== 'ADD_CHECK' && apps.length === 0) throw bad('The design has no app server');
  switch (fix.type) {
    case 'ADD_INDEX': {
      const t = table(fix.table);
      const cols = new Set(t.columns.map((c) => c.name));
      fix.columns.filter((c) => !cols.has(c)).forEach((c) => { throw bad(`Unknown column ${fix.table}.${c}`); });
      const key = fix.columns.join(',');
      if (!t.indexes.some((i) => i.columns.join(',') === key || i.name === fix.name)) t.indexes.push({ name: fix.name, columns: fix.columns, unique: false });
      return { design: d, note: `Advisor: add index on ${fix.table}(${fix.columns.join(', ')})` };
    }
    case 'SET_STRATEGY':
      apps.forEach((a) => { a.config.strategy = fix.strategy; });
      return { design: d, note: `Advisor: use ${fix.strategy} strategy` };
    case 'SET_POOL':
      apps.forEach((a) => { a.config.poolSize = Math.min(100, Math.max(1, Math.round(fix.poolSize))); });
      return { design: d, note: `Advisor: pool size ${fix.poolSize}` };
    case 'SET_INSTANCES':
      apps.forEach((a) => { a.config.instances = Math.min(8, Math.max(1, Math.round(fix.instances))); });
      return { design: d, note: `Advisor: ${fix.instances} app instances` };
    case 'ADD_CHECK': {
      const t = table(fix.table);
      if (!t.checks.some((c) => c.expr === fix.expr)) t.checks.push({ expr: fix.expr });
      return { design: d, note: `Advisor: add CHECK on ${fix.table} (${fix.expr})` };
    }
  }
}

/** Applies a machine-applicable finding fix to the draft, then pins a new revision. */
export async function applyFix(projectId: string, fix: FindingFix, note?: string): Promise<{ revisionNo: number; design: DesignDoc }> {
  const next = applyFixToDesign(await getDraft(projectId), fix);
  await saveDraft(projectId, next.design);
  const pinned = await pinCurrent(projectId, note ?? next.note);
  return { revisionNo: pinned.revisionNo, design: pinned.design };
}

