import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { SOCKET_EVENTS } from '@datasim/shared';
import { appPool } from '../../src/db/pool.js';
import { getActiveRunId } from '../../src/engine/active.js';
import { cancelRun, loadReport, listRuns, provisionSandbox, reportToCsv, reportToMarkdown, sandboxQuery, startRun, testTransaction } from '../../src/engine/index.js';
import { setRunEmitter } from '../../src/realtime/runEmitter.js';
import { ServiceError } from '../../src/services/liveStrategy.js';
import { cleanupProject, makeProject, miniDesign, startRunWhenFree } from './helpers.js';

const events: Array<{ runId: string; event: string; payload: any }> = [];
const created: string[] = [];

beforeAll(() => { setRunEmitter((runId, event, payload) => { events.push({ runId, event, payload }); }); });
afterAll(async () => {
  setRunEmitter(null);
  for (const id of created) await cleanupProject(id);
  await appPool.end().catch(() => undefined);
});

async function project(design = miniDesign()) {
  const p = await makeProject(design);
  created.push(p.projectId);
  return p;
}
async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const [rows] = await appPool.query<RowDataPacket[]>(sql, params);
  return Number(Object.values(rows[0]!)[0]);
}

describe('mini end-to-end run', () => {
  it('runs 2 s of real load, streams events and persists everything relationally', async () => {
    const p = await project();
    events.length = 0;
    const { runId, done } = await startRunWhenFree({ projectId: p.projectId, revisionNo: p.revisionNo, design: p.design, kind: 'LOAD', overrides: { strategy: 'atomic' } });
    expect(getActiveRunId()).toBe(runId);
    const summary = await done;
    expect(getActiveRunId()).toBeNull();
    expect(summary.status).toBe('COMPLETED');
    expect(summary.txnTotal).toBeGreaterThan(30);
    expect(summary.tpsAvg).toBeGreaterThan(10);
    expect(summary.p95Ms).toBeGreaterThan(0);
    expect(summary.p50Ms).toBeLessThanOrEqual(summary.p95Ms);
    expect(summary.committed + summary.rejected + summary.errored).toBe(summary.txnTotal);
    expect(summary.mysqlVersion).toMatch(/^8\./);

    const report = (await loadReport(runId))!;
    expect(report.design.nodes).toHaveLength(3);
    expect(report.samples.length).toBeGreaterThanOrEqual(1);
    expect(report.samples.map((s) => s.tS)).toEqual(report.samples.map((_, i) => i + 1));
    expect(report.samples[0]!.activeVus).toBe(30);
    const reg = report.txnStats.find((t) => t.txnName === 'register')!;
    const search = report.txnStats.find((t) => t.txnName === 'search')!;
    expect(reg.count).toBeGreaterThan(0);
    expect(search.count).toBeGreaterThan(0);
    expect(reg.dbMs).toBeGreaterThan(0);
    expect(reg.queueMs + reg.netMs + reg.appMs + reg.poolMs + reg.dbMs).toBeLessThanOrEqual(reg.meanMs * 1.2 + 1);
    expect(report.statementStats.length).toBeGreaterThan(0);
    expect(report.statementStats.some((s) => s.txnName === 'search' && s.explain !== null)).toBe(true);

    // atomic strategy: at most `capacity` seats are ever granted
    expect(report.invariants).toHaveLength(1);
    expect(report.invariants[0]).toMatchObject({ name: 'no_overbooking', violations: 0, passed: true });
    const seats = await scalar(`SELECT COUNT(*) FROM \`dsim_${p.projectId.replace(/-/g, '').slice(0, 8)}\`.enrollment`);
    expect(seats).toBeLessThanOrEqual(5);
    expect(report.slo).not.toBeNull();

    // advisor: the unindexed `item.slot` filter shows up as a full scan with a machine-applicable fix
    const scan = report.findings.find((f) => f.kind === 'FULL_SCAN');
    expect(scan, JSON.stringify(report.findings.map((f) => f.title))).toBeDefined();
    expect(scan!.fix).toEqual({ type: 'ADD_INDEX', table: 'item', columns: ['slot'], name: 'ix_item_slot' });
    expect(scan!.explanation.split('. ').length).toBeGreaterThanOrEqual(2);

    // relational persistence
    expect(await scalar('SELECT COUNT(*) FROM run_sample WHERE run_id = ?', [runId])).toBe(report.samples.length);
    expect(await scalar('SELECT COUNT(*) FROM run_txn_stat WHERE run_id = ?', [runId])).toBe(2);
    expect(await scalar('SELECT COUNT(*) FROM run_statement_stat WHERE run_id = ?', [runId])).toBe(report.statementStats.length);
    expect(await scalar('SELECT COUNT(*) FROM run_invariant WHERE run_id = ?', [runId])).toBe(1);
    expect(await scalar('SELECT COUNT(*) FROM run_finding WHERE run_id = ?', [runId])).toBe(report.findings.length);

    // socket events: status transitions, provisioning progress, 1 Hz samples with per-node pills, finished
    const mine = events.filter((e) => e.runId === runId);
    expect(mine.filter((e) => e.event === SOCKET_EVENTS.progress).length).toBeGreaterThan(0);
    const statuses = new Set(mine.filter((e) => e.event === SOCKET_EVENTS.status).map((e) => e.payload.status));
    for (const s of ['PROVISIONING', 'WARMING', 'RUNNING', 'ANALYZING']) expect(statuses.has(s)).toBe(true);
    const live = mine.filter((e) => e.event === SOCKET_EVENTS.sample);
    expect(live.length).toBeGreaterThanOrEqual(3);
    expect(live[0]!.payload.sample.nodes.a).toMatchObject({ pool: expect.any(Number), poolMax: 20 });
    expect(live.at(-1)!.payload.sample.nodes.d.threads).toBeGreaterThanOrEqual(0);
    expect(mine.at(-1)).toMatchObject({ event: SOCKET_EVENTS.finished, payload: { status: 'COMPLETED' } });

    // list + exports
    expect((await listRuns({ projectId: p.projectId })).map((r) => r.runId)).toContain(runId);
    expect(reportToMarkdown(report)).toContain('## Findings');
    expect(reportToCsv(report).split('\n')[0]).toContain('t_s,tps');
    expect(reportToCsv(report, 'txn')).toContain('register');
  }, 300_000);

  it('naive read-then-write overbooks a hot section; the atomic variant never does', async () => {
    const p = await project(miniDesign({ users: { vus: 40, durationS: 2, warmupS: 1 } }));
    const naive = await (await startRunWhenFree({ projectId: p.projectId, revisionNo: p.revisionNo, design: p.design, kind: 'LOAD', overrides: { strategy: 'naive' } })).done;
    const nr = (await loadReport(naive.runId))!;
    expect(nr.invariants[0]!.violations, 'naive should overbook with 40 concurrent registrations on a 5-seat section').toBeGreaterThan(0);
    expect(naive.invariantViolations).toBeGreaterThan(0);
    // an invariant violation fails the verdict even though latency and errors are inside the SLO, and is listed first
    expect(naive.sloPass).toBe(false);
    expect(nr.slo!.pass).toBe(false);
    expect(nr.slo!.reasons[0]).toMatch(/^Invariant no_overbooking violated \(\d+ violations?\)$/);
    expect(reportToMarkdown(nr)).toContain('SLO verdict: **FAIL** (Invariant no_overbooking violated');
    const finding = nr.findings.find((f) => f.kind === 'INVARIANT_NAIVE')!;
    expect(finding).toBeDefined();
    expect(finding.severity).toBe('HIGH');
    expect(finding.fix).toEqual({ type: 'SET_STRATEGY', strategy: 'atomic' });

    const atomic = await (await startRunWhenFree({ projectId: p.projectId, revisionNo: p.revisionNo, design: p.design, kind: 'LOAD', overrides: { strategy: 'atomic' } })).done;
    const ar = (await loadReport(atomic.runId))!;
    expect(ar.invariants[0]).toMatchObject({ violations: 0, passed: true });
    expect(atomic.invariantViolations).toBe(0);
    expect(atomic.sloPass).toBe(true);
    expect(ar.findings.find((f) => f.kind === 'INVARIANT_NAIVE')).toBeUndefined();
  }, 300_000);

  it('rejects a second concurrent run with 409 RUN_ACTIVE and can cancel the first', async () => {
    const p = await project(miniDesign({ users: { durationS: 20, warmupS: 1 } }));
    const first = await startRunWhenFree({ projectId: p.projectId, revisionNo: p.revisionNo, design: p.design, kind: 'LOAD', overrides: {} });
    const err = await startRun({ projectId: p.projectId, revisionNo: p.revisionNo, design: p.design, kind: 'LOAD', overrides: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('RUN_ACTIVE');
    expect(await provisionSandbox(p.projectId, p.design).catch((e) => e.code)).toBe('RUN_ACTIVE');
    await new Promise((r) => setTimeout(r, 2500));
    expect(await cancelRun(first.runId)).toBe(true);
    const s = await first.done;
    expect(s.status).toBe('CANCELLED');
    expect(getActiveRunId()).toBeNull();
  }, 300_000);

  it('rejects an invalid design with 400 before touching the run lock', async () => {
    const p = await project(miniDesign());
    const bad = structuredClone(p.design);
    bad.nodes = bad.nodes.filter((n) => n.type !== 'mysql');
    const err = await startRun({ projectId: p.projectId, revisionNo: p.revisionNo, design: bad, kind: 'LOAD', overrides: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.code).toBe('INVALID_DESIGN');
    expect(getActiveRunId()).toBeNull();
  }, 30_000);
});

describe('sandbox operations', () => {
  it('provisions, tests a transaction once with rollback, and serves read-only queries', async () => {
    const p = await project();
    const notYet = await testTransaction(p.projectId, p.design, { txnName: 'register' }).catch((e) => e);
    expect(notYet.code).toBe('NOT_PROVISIONED');
    const prov = await provisionSandbox(p.projectId, p.design);
    expect(prov.tables).toBe(3);
    expect(prov.rows).toBe(2001);

    const t = await testTransaction(p.projectId, p.design, { txnName: 'register', variant: 'atomic' });
    expect(t.variant).toBe('atomic');
    expect(t.outcome).toBe('COMMITTED_THEN_ROLLED_BACK');
    expect(t.steps).toHaveLength(2);
    expect(t.steps[0]).toMatchObject({ affected: 1 });
    expect(t.steps[1]!.ms).toBeGreaterThan(0);
    const after = await sandboxQuery(p.projectId, 'SELECT enrolled FROM seat_section WHERE section_id = 1');
    expect(after.rows).toEqual([[0]]); // rolled back

    const naive = await testTransaction(p.projectId, p.design, { txnName: 'register' });
    expect(naive.variant).toBe('default');
    expect(naive.steps[0]!.guard).toMatchObject({ passed: true });
    expect(naive.steps[0]!.rows).toHaveLength(1);

    const q = await sandboxQuery(p.projectId, 'SELECT item_id, slot FROM item');
    expect(q.columns).toEqual(['item_id', 'slot']);
    expect(q.rows).toHaveLength(200);
    expect(q.truncated).toBe(true);
    expect(await sandboxQuery(p.projectId, 'DELETE FROM item').catch((e) => e.code)).toBe('BAD_SQL');
    expect(await sandboxQuery(p.projectId, 'SELECT 1; SELECT 2').catch((e) => e.code)).toBe('BAD_SQL');
    expect(await sandboxQuery(p.projectId, 'SELECT * FROM nope').catch((e) => e.code)).toBe('QUERY_ERROR');
    expect(await scalar(`SELECT COUNT(*) FROM \`dsim_${p.projectId.replace(/-/g, '').slice(0, 8)}\`.item`)).toBe(2000);
  }, 60_000);
});
