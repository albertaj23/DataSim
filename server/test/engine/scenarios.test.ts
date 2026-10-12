import { afterAll, describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { DesignDoc } from '@datasim/shared';
import { appPool } from '../../src/db/pool.js';
import { loadReport } from '../../src/engine/index.js';
import { cleanupProject, compareWhenFree, makeProject, miniDesign, startRunWhenFree } from './helpers.js';

const created: string[] = [];
afterAll(async () => { for (const id of created) await cleanupProject(id); await appPool.end().catch(() => undefined); });
async function project(design: DesignDoc) { const p = await makeProject(design); created.push(p.projectId); return p; }
const count = async (sql: string, params: unknown[]) => Number(Object.values(((await appPool.query<RowDataPacket[]>(sql, params))[0])[0]!)[0]);
const int = { kind: 'INT' } as const;
const node = (id: string, type: string, config: object, x = 0) => ({ id, type, name: id, position: { x, y: 0 }, config });
const edge = (id: string, source: string, target: string, latencyMs = 1) => ({ id, source, target, latencyMs, jitterMs: 0 });

describe('scenario runs', () => {
  it('counts deadlocks (errno 1213), retries them and raises a DEADLOCK_ORDER finding', async () => {
    const d = DesignDoc.parse({
      nodes: [node('u', 'users', { vus: 24, thinkMinMs: 0, thinkMaxMs: 2, durationS: 3, warmupS: 1 }), node('a', 'app', { poolSize: 24, workers: 64, processingMeanMs: 0, processingJitterMs: 0, retry: { max: 3, backoffMs: 5 }, strategy: 'default' }), node('d', 'mysql', {})],
      edges: [edge('e1', 'u', 'a', 0), edge('e2', 'a', 'd', 0)],
      schema: { tables: [{ name: 'acct', primaryKey: ['id'], seedRows: 2, columns: [{ name: 'id', type: int, seed: { kind: 'sequence', start: 1, step: 1 } }, { name: 'bal', type: int, seed: { kind: 'constant', value: 100 } }] }] },
      workload: {
        transactions: [{
          name: 'transfer', weight: 1, params: { a: { kind: 'uniformInt', min: 1, max: 2 }, b: { kind: 'uniformInt', min: 1, max: 2 } },
          variants: {
            default: [{ sql: 'UPDATE acct SET bal = bal - 1 WHERE id = :a' }, { sql: 'UPDATE acct SET bal = bal + 1 WHERE id = :b' }],
            pessimistic: [{ sql: 'UPDATE acct SET bal = bal - 1 WHERE id = LEAST(:a, :b) AND :a <> :b' }, { sql: 'UPDATE acct SET bal = bal + 1 WHERE id = GREATEST(:a, :b) AND :a <> :b' }],
          },
        }],
        invariants: [{ name: 'conserved', sql: 'SELECT ABS(SUM(bal) - 200) AS violations FROM acct' }],
      },
      slo: { p95Ms: 2000, maxErrorPct: 50 },
    });
    const p = await project(d);
    const s = await (await startRunWhenFree({ projectId: p.projectId, revisionNo: p.revisionNo, design: p.design, kind: 'LOAD', overrides: {} })).done;
    expect(s.status).toBe('COMPLETED');
    expect(s.deadlocks).toBeGreaterThan(0);
    expect(s.retries).toBeGreaterThan(0);
    const r = (await loadReport(s.runId))!;
    expect(r.txnStats[0]!.deadlocks).toBe(s.deadlocks);
    const f = r.findings.find((x) => x.kind === 'DEADLOCK_ORDER')!;
    expect(f).toBeDefined();
    expect(f.fix).toEqual({ type: 'SET_STRATEGY', strategy: 'pessimistic' });
    expect(r.invariants[0]!.passed).toBe(true); // rollbacks keep the books balanced
    console.log(`deadlocks=${s.deadlocks} retries=${s.retries} errored=${s.errored} lockWaitRows=${r.lockWaits.length} bottleneck=${r.bottleneck?.kind ?? 'none'}`);
  }, 300_000);

  it('samples InnoDB lock waits, names the blocking transactions and flags a HOT_ROW', async () => {
    const d = DesignDoc.parse({
      nodes: [node('u', 'users', { vus: 30, thinkMinMs: 0, thinkMaxMs: 2, durationS: 4, warmupS: 1 }), node('a', 'app', { poolSize: 30, workers: 64, processingMeanMs: 0, processingJitterMs: 0, strategy: 'default' }), node('d', 'mysql', {})],
      edges: [edge('e1', 'u', 'a', 0), edge('e2', 'a', 'd', 4)],
      schema: { tables: [{ name: 'hits', primaryKey: ['id'], seedRows: 1, columns: [{ name: 'id', type: int, seed: { kind: 'sequence', start: 1, step: 1 } }, { name: 'n', type: int, seed: { kind: 'constant', value: 0 } }] }] },
      workload: {
        transactions: [{ name: 'bump', weight: 1, variants: { default: [{ sql: 'UPDATE hits SET n = n + 1 WHERE id = 1' }], atomic: [{ sql: 'UPDATE hits SET n = n + 1 WHERE id = 1' }] } }],
        invariants: [{ name: 'counted', sql: 'SELECT 0 AS violations' }],
      },
      slo: { p95Ms: 5000, maxErrorPct: 50 },
    });
    const p = await project(d);
    const s = await (await startRunWhenFree({ projectId: p.projectId, revisionNo: p.revisionNo, design: p.design, kind: 'LOAD', overrides: {} })).done;
    expect(s.status).toBe('COMPLETED');
    const r = (await loadReport(s.runId))!;
    const db = (r.settings as { db: { rowLockWaits: number; rowLockTimeMs: number; comSelect: number; comWrite: number } }).db;
    expect(db.rowLockWaits).toBeGreaterThan(10);
    expect(db.rowLockTimeMs).toBeGreaterThan(0);
    expect(db.comWrite).toBeGreaterThan(10); // live statement counters, not session-merged Com_*
    expect(r.samples.some((x) => x.rowLockWaits > 0 && x.lockWaitMs > 0)).toBe(true);
    expect(r.lockWaits.length).toBeGreaterThan(0);
    expect(r.lockWaits[0]).toMatchObject({ waitingTxn: 'bump', blockingTxn: 'bump', tableName: 'hits' });
    expect(await count('SELECT COUNT(*) FROM run_lock_wait WHERE run_id = ?', [s.runId])).toBe(r.lockWaits.length);
    const hot = r.findings.find((f) => f.kind === 'HOT_ROW')!;
    expect(hot, JSON.stringify(r.findings.map((f) => f.kind))).toBeDefined();
    expect(hot.evidence).toMatchObject({ table: 'hits' });
    expect(hot.fix).toEqual({ type: 'SET_STRATEGY', strategy: 'atomic' });
    expect(r.bottleneck).toMatchObject({ kind: 'db' });
  }, 300_000);

  it('routes through LB -> 2 app instances -> real Redis cache-aside and measures the hit ratio', async () => {
    const d = DesignDoc.parse({
      nodes: [node('u', 'users', { vus: 20, thinkMinMs: 1, thinkMaxMs: 5, durationS: 3, warmupS: 1 }), node('l', 'lb', { algorithm: 'least-connections' }), node('a', 'app', { instances: 2, poolSize: 8, workers: 16, processingMeanMs: 1, processingJitterMs: 0 }), node('r', 'redis', { ttlS: 30 }), node('d', 'mysql', {})],
      edges: [edge('e1', 'u', 'l'), edge('e2', 'l', 'a'), edge('e3', 'a', 'r', 0.5), edge('e4', 'a', 'd')],
      schema: miniDesign().schema,
      workload: { transactions: [{ name: 'search', weight: 1, readOnly: true, cacheable: true, params: { slot: { kind: 'pickList', values: ['A1', 'B2', 'C3', 'D4', 'E5'] } }, variants: { default: [{ sql: 'SELECT item_id FROM item WHERE slot = :slot LIMIT 5' }] } }], invariants: [] },
    });
    const p = await project(d);
    const s = await (await startRunWhenFree({ projectId: p.projectId, revisionNo: p.revisionNo, design: p.design, kind: 'LOAD', overrides: {} })).done;
    expect(s.status).toBe('COMPLETED');
    const r = (await loadReport(s.runId))!;
    expect(r.cacheHitRatio).toBeGreaterThan(0.9);
    expect(r.samples.some((x) => x.cacheHitRatio !== null)).toBe(true);
    expect((r.settings as { nodes: Array<{ instances: number; poolMax: number }> }).nodes[0]).toMatchObject({ instances: 2, poolMax: 16 });
    // network (emulated links + redis RTT) is part of the measured breakdown
    expect(r.txnStats[0]!.netMs).toBeGreaterThan(1);
  }, 300_000);

  it('runs a capacity test, fits the USL and persists points + fit', async () => {
    const p = await project(miniDesign({ users: { thinkMinMs: 5, thinkMaxMs: 10 } }));
    const s = await (await startRunWhenFree({ projectId: p.projectId, revisionNo: p.revisionNo, design: p.design, kind: 'CAPACITY', overrides: { capacitySteps: [2, 6, 12], capacityStepDurationS: 2, warmupS: 1, strategy: 'atomic' } })).done;
    expect(s.status).toBe('COMPLETED');
    expect(s.kind).toBe('CAPACITY');
    const r = (await loadReport(s.runId))!;
    expect(r.capacity!.points.map((x) => x.vus)).toEqual([2, 6, 12]);
    expect(r.capacity!.points.every((x) => x.tps > 0 && x.p95Ms > 0)).toBe(true);
    expect(r.capacity!.fit).not.toBeNull();
    expect(r.capacity!.fit!.sigma).toBeGreaterThanOrEqual(0);
    expect(r.capacity!.fit!.kappa).toBeGreaterThanOrEqual(0);
    expect(r.capacity!.sentence).toMatch(/VUs/);
    expect(await count('SELECT COUNT(*) FROM capacity_point WHERE run_id = ?', [s.runId])).toBe(3);
    expect(await count('SELECT COUNT(*) FROM capacity_fit WHERE run_id = ?', [s.runId])).toBe(1);
    const ts = r.samples.map((x) => x.tS);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(r.slo).not.toBeNull();
    // the headline counters, latency and per-transaction table all describe the same (sustained) step
    const head = (r.settings as { headlineStep: { vus: number }; capacity: { refStepVus: number } });
    expect(head.headlineStep.vus).toBe(head.capacity.refStepVus);
    expect(r.txnStats.reduce((x, t) => x + t.count, 0)).toBe(s.txnTotal);
    expect(r.txnStats.reduce((x, t) => x + t.committed, 0)).toBe(s.committed);
    expect(r.txnStats.reduce((x, t) => x + t.rejected, 0)).toBe(s.rejected);
    expect(r.findings.some((f) => /knee/i.test(f.title))).toBe(true);
    expect((r.settings as { littlesLaw: unknown[] }).littlesLaw).toHaveLength(3);
    console.log(r.capacity!.sentence, JSON.stringify(r.capacity!.points.map((x) => [x.vus, x.tps, x.p95Ms])));
  }, 300_000);

  it('compares strategies: one STRATEGY_CHILD per variant under a parent run, same seed', async () => {
    const p = await project(miniDesign());
    const c = await compareWhenFree({ projectId: p.projectId, revisionNo: p.revisionNo, design: p.design, overrides: { durationS: 2, warmupS: 1 } });
    expect(c.runIds).toHaveLength(2);
    const kids = await c.done;
    expect(kids.map((k) => k.strategy)).toEqual(['default', 'atomic']);
    expect(kids.every((k) => k.status === 'COMPLETED' && k.kind === 'STRATEGY_CHILD' && k.parentRunId === c.parentRunId && k.seed === kids[0]!.seed)).toBe(true);
    const parent = (await loadReport(c.parentRunId))!;
    expect(parent.run.status).toBe('COMPLETED');
    expect(await count('SELECT COUNT(*) FROM run WHERE parent_run_id = ?', [c.parentRunId])).toBe(2);
    const atomic = await loadReport(kids[1]!.runId);
    expect(atomic!.invariants[0]!.violations).toBe(0);
  }, 300_000);
});
