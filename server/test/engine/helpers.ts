import { DesignDoc } from '@datasim/shared';
import { appPool } from '../../src/db/pool.js';
import { adminConnect, sandboxName } from '../../src/engine/admin.js';
import { createProjectFromDesign, pinCurrent } from '../../src/projects/service.js';

const nodes = (u: object = {}, a: object = {}, m: object = {}) => [
  { id: 'u', type: 'users', name: 'Users', position: { x: 0, y: 0 }, config: { vus: 30, thinkMinMs: 0, thinkMaxMs: 5, thinkDist: 'uniform', pattern: 'constant', durationS: 2, warmupS: 1, ...u } },
  { id: 'a', type: 'app', name: 'App', position: { x: 200, y: 0 }, config: { instances: 1, workers: 64, processingMeanMs: 0, processingJitterMs: 0, poolSize: 20, strategy: 'default', retry: { max: 2, backoffMs: 5 }, ...a } },
  { id: 'd', type: 'mysql', name: 'MySQL', position: { x: 400, y: 0 }, config: { isolation: 'REPEATABLE READ', lockWaitTimeoutS: 3, maxExecutionTimeMs: 0, ...m } },
];
const edges = [
  { id: 'e1', source: 'u', target: 'a', latencyMs: 0, jitterMs: 0 },
  { id: 'e2', source: 'a', target: 'd', latencyMs: 0, jitterMs: 0 },
];

const int = { kind: 'INT' } as const;
/** Tiny ad-hoc design: one hot section (capacity 5) with naive/atomic registration, plus an unindexed 2,000-row table for the advisor. */
export function miniDesign(opts: { users?: object; app?: object; mysql?: object; sections?: number; capacity?: number } = {}): DesignDoc {
  const sections = opts.sections ?? 1;
  return DesignDoc.parse({
    nodes: nodes(opts.users, opts.app, opts.mysql),
    edges,
    schema: {
      tables: [
        {
          name: 'seat_section', primaryKey: ['section_id'], seedRows: sections,
          columns: [
            { name: 'section_id', type: int, seed: { kind: 'sequence', start: 1, step: 1 } },
            { name: 'capacity', type: int, seed: { kind: 'constant', value: opts.capacity ?? 5 } },
            { name: 'enrolled', type: int, default: 0 },
          ],
          checks: [{ expr: '`enrolled` >= 0' }],
        },
        {
          name: 'enrollment', primaryKey: ['student_id', 'section_id'], seedRows: 0,
          columns: [{ name: 'student_id', type: int }, { name: 'section_id', type: int }],
          foreignKeys: [{ columns: ['section_id'], refTable: 'seat_section', refColumns: ['section_id'] }],
        },
        {
          name: 'item', primaryKey: ['item_id'], seedRows: 2000,
          columns: [
            { name: 'item_id', type: int, autoIncrement: true },
            { name: 'slot', type: { kind: 'VARCHAR', length: 8 }, seed: { kind: 'pickList', values: ['A1', 'B2', 'C3', 'D4', 'E5'] } },
            { name: 'name', type: { kind: 'VARCHAR', length: 40 } },
          ],
        },
      ],
    },
    workload: {
      transactions: [
        {
          name: 'register', weight: 80, readOnly: false,
          params: { sid: { kind: 'uniformInt', min: 1, max: sections }, student: { kind: 'uniformInt', min: 1, max: 1_000_000_000 } },
          variants: {
            default: [
              { sql: 'SELECT enrolled, capacity FROM seat_section WHERE section_id = :sid', bindAs: 's', guard: { left: '$s.enrolled', op: '<', right: '$s.capacity', onFail: 'reject' } },
              { sql: 'INSERT INTO enrollment (student_id, section_id) VALUES (:student, :sid)' },
              { sql: 'UPDATE seat_section SET enrolled = :$s.enrolled + 1 WHERE section_id = :sid' },
            ],
            atomic: [
              { sql: 'UPDATE seat_section SET enrolled = enrolled + 1 WHERE section_id = :sid AND enrolled < capacity', expectAffected: { op: '=', value: 1, onFail: 'reject' } },
              { sql: 'INSERT INTO enrollment (student_id, section_id) VALUES (:student, :sid)' },
            ],
          },
        },
        {
          name: 'search', weight: 20, readOnly: true, params: { slot: { kind: 'pickList', values: ['A1', 'B2', 'C3', 'D4', 'E5'] } },
          variants: { default: [{ sql: 'SELECT item_id, name FROM item WHERE slot = :slot LIMIT 20' }] },
        },
      ],
      invariants: [
        { name: 'no_overbooking', description: 'A section never has more enrollments than capacity', sql: 'SELECT COUNT(*) AS violations FROM seat_section s WHERE (SELECT COUNT(*) FROM enrollment e WHERE e.section_id = s.section_id) > s.capacity' },
      ],
    },
    slo: { p95Ms: 500, maxErrorPct: 50 },
  });
}

export async function makeProject(design: DesignDoc): Promise<{ projectId: string; revisionNo: number; design: DesignDoc }> {
  const projectId = await createProjectFromDesign('engine test', design);
  const pinned = await pinCurrent(projectId, 'test');
  return { projectId, revisionNo: pinned.revisionNo, design: pinned.design };
}

export async function cleanupProject(projectId: string): Promise<void> {
  await appPool.query('DELETE FROM run WHERE project_id = ? AND parent_run_id IS NOT NULL', [projectId]);
  await appPool.query('DELETE FROM run WHERE project_id = ?', [projectId]);
  await appPool.query('DELETE FROM project WHERE project_id = ?', [projectId]);
  const c = await adminConnect();
  await c.query(`DROP DATABASE IF EXISTS \`${sandboxName(projectId)}\``).catch(() => undefined);
  await c.end();
}

import { startRun } from '../../src/engine/index.js';
import type { StartRunArgs } from '../../src/engine/index.js';

/** Other suites/processes may hold the global run lock (shared dev DB): wait for it instead of failing. */
export async function startRunWhenFree(args: StartRunArgs, maxWaitMs = 240_000): Promise<Awaited<ReturnType<typeof startRun>>> {
  const t0 = Date.now();
  for (;;) {
    try { return await startRun(args); } catch (e) {
      if ((e as { code?: string }).code !== 'RUN_ACTIVE' || Date.now() - t0 > maxWaitMs) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

import { startStrategyCompare } from '../../src/engine/index.js';
export async function compareWhenFree(args: Parameters<typeof startStrategyCompare>[0], maxWaitMs = 240_000): Promise<Awaited<ReturnType<typeof startStrategyCompare>>> {
  const t0 = Date.now();
  for (;;) {
    try { return await startStrategyCompare(args); } catch (e) {
      if ((e as { code?: string }).code !== 'RUN_ACTIVE' || Date.now() - t0 > maxWaitMs) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
