import { describe, expect, it, vi } from 'vitest';
import { NODE_LIMITS, emptyDesign, validateDesign, type DesignDoc, type RunSample, type RunReport } from '@datasim/shared';
import { checkConnection } from './connect';
import { NODE_H, NODE_W, autoLayout } from './layout';
import { currentIsolation, currentStrategy, patchConfig, schemaSummary, setIsolation, setStrategy, workloadSummary } from './mutations';
import { addNode, canAddNode, configPills, defaultConfig, dotCount, duplicateNode, edgeFlow, livePills, newEdge, removeItems, snap, suggestPosition, uniqueName } from './nodes';
import { healthByNode, mergeProblems, problemTarget, problemWhere } from './problems';
import {
  RING_CAP, appendSamples, applyFinished, applyLocks, applyProgress, applyReport, applyStatus, begin, createSampleBuffer, describePhase, initialRunState, isActive, phaseFill, phaseIndex,
} from './runStore';

/** users -> lb -> app -> (redis, mysql) */
function topology(): DesignDoc {
  const d = emptyDesign();
  for (const t of ['users', 'lb', 'app', 'redis', 'mysql'] as const) {
    const r = addNode(d, t);
    if (!r.ok) throw new Error(r.reason);
  }
  const id = (t: string) => d.nodes.find((n) => n.type === t)!.id;
  d.edges.push(newEdge(d, id('users'), id('lb')), newEdge(d, id('lb'), id('app')), newEdge(d, id('app'), id('redis')), newEdge(d, id('app'), id('mysql')));
  return d;
}

describe('connection validation (checkConnection)', () => {
  const d = topology();
  const id = (t: string) => d.nodes.find((n) => n.type === t)!.id;

  it('accepts the Packet-Tracer-legal links', () => {
    const fresh = emptyDesign();
    for (const t of ['users', 'app', 'mysql'] as const) addNode(fresh, t);
    const ids = Object.fromEntries(fresh.nodes.map((n) => [n.type, n.id]));
    expect(checkConnection(fresh, ids.users, ids.app).ok).toBe(true);
    expect(checkConnection(fresh, ids.app, ids.mysql).ok).toBe(true);
  });

  it('rejects illegal pairs with a reason a toast can show', () => {
    const r = checkConnection(d, id('mysql'), id('app'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/leaf/);
    const r2 = checkConnection(d, id('users'), id('mysql'));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/Users cannot connect to Database/);
  });

  it('rejects self links, duplicates and unknown nodes', () => {
    expect(checkConnection(d, id('app'), id('app'))).toEqual({ ok: false, reason: 'A node cannot connect to itself' });
    const dup = checkConnection(d, id('users'), id('lb'));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toMatch(/already connected/);
    expect(checkConnection(d, 'nope', id('app')).ok).toBe(false);
    expect(checkConnection(d, null, id('app')).ok).toBe(false);
  });
});

describe('add-node defaults and limits', () => {
  it('uses the shared zod defaults', () => {
    expect(defaultConfig('users')).toMatchObject({ vus: 100, pattern: 'constant' });
    expect(defaultConfig('app')).toMatchObject({ instances: 1, poolSize: 16, strategy: 'default', retry: { max: 3 } });
    expect(defaultConfig('mysql')).toMatchObject({ isolation: 'REPEATABLE READ', lockWaitTimeoutS: 3 });
    expect(defaultConfig('redis')).toEqual({ ttlS: 30 });
    expect(defaultConfig('lb')).toEqual({ algorithm: 'round-robin' });
  });

  it('a freshly built topology validates without topology errors', () => {
    const errs = validateDesign(topology()).filter((p) => p.severity === 'error' && ['NO_USERS', 'NO_APP', 'NO_DB', 'BAD_EDGE', 'DB_UNREACHABLE', 'APP_NO_DB'].includes(p.code));
    expect(errs).toEqual([]);
  });

  it('enforces NODE_LIMITS', () => {
    const d = emptyDesign();
    expect(canAddNode(d, 'mysql')).toEqual({ ok: true });
    addNode(d, 'mysql');
    const again = addNode(d, 'mysql');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toMatch(/At most 1 database/);
    for (let i = 0; i < NODE_LIMITS.app; i++) expect(addNode(d, 'app').ok).toBe(true);
    expect(addNode(d, 'app').ok).toBe(false);
    expect(d.nodes.filter((n) => n.type === 'app')).toHaveLength(NODE_LIMITS.app);
  });

  it('generates unique names and ids', () => {
    const d = emptyDesign();
    for (let i = 0; i < 3; i++) addNode(d, 'app');
    expect(d.nodes.map((n) => n.name)).toEqual(['App server', 'App server 2', 'App server 3']);
    expect(new Set(d.nodes.map((n) => n.id)).size).toBe(3);
    expect(uniqueName(d, 'Cache')).toBe('Cache');
  });

  it('click-add lands in the type column below existing nodes, on the grid', () => {
    const d = emptyDesign();
    addNode(d, 'app');
    const p = suggestPosition(d, 'app');
    expect(p.y).toBeGreaterThan(d.nodes[0]!.position.y);
    expect(p.x).toBe(d.nodes[0]!.position.x);
    expect(snap(37)).toBe(32);
    expect(p.y % 16).toBe(0);
  });

  it('duplicate copies config under a new id and name, respecting limits', () => {
    const d = emptyDesign();
    addNode(d, 'app');
    patchConfig(d, d.nodes[0]!.id, 'app', { poolSize: 40 });
    const r = duplicateNode(d, d.nodes[0]!.id);
    expect(r.ok).toBe(true);
    const copy = d.nodes[1]!;
    expect(copy.name).toBe('App server 2');
    expect(copy.type === 'app' && copy.config.poolSize).toBe(40);
    expect(copy.id).not.toBe(d.nodes[0]!.id);
    addNode(d, 'mysql');
    const my = d.nodes.find((n) => n.type === 'mysql')!;
    expect(duplicateNode(d, my.id).ok).toBe(false);
  });

  it('removeItems drops incident edges', () => {
    const d = topology();
    const lb = d.nodes.find((n) => n.type === 'lb')!;
    removeItems(d, [lb.id]);
    expect(d.nodes.some((n) => n.id === lb.id)).toBe(false);
    expect(d.edges.every((e) => e.source !== lb.id && e.target !== lb.id)).toBe(true);
    expect(d.edges).toHaveLength(2);
  });

  it('newEdge ids are unique per pair', () => {
    const d = emptyDesign();
    const a = newEdge(d, 'x', 'y'); d.edges.push(a);
    expect(newEdge(d, 'x', 'y').id).not.toBe(a.id);
  });
});

describe('pills', () => {
  it('config pills at rest', () => {
    const d = topology();
    const pill = (t: string) => configPills(d.nodes.find((n) => n.type === t)!);
    expect(pill('users')).toEqual(['100 VUs']);
    expect(pill('lb')).toEqual(['RR']);
    expect(pill('app')).toEqual(['1× pool 16']);
    expect(pill('redis')).toEqual(['ttl 30s']);
    expect(pill('mysql')).toEqual(['RR', 'lwt 3s']);
  });

  it('live pills come from RunSample.nodes keys', () => {
    expect(livePills('app', { tps: 812.4, p95: 41, pool: 16, poolMax: 16 })).toEqual([{ text: '812 tps' }, { text: 'p95 41ms' }, { text: 'pool 16/16', tone: 'amber' }]);
    expect(livePills('redis', { hit: 0.87 })).toEqual([{ text: 'hit 87%' }]);
    expect(livePills('mysql', { tps: 500, threads: 7, lockWaits: 0 })).toEqual([{ text: '500 tps' }, { text: 'thr 7' }]);
    expect(livePills('users', undefined)).toEqual([]);
  });

  it('dot count is proportional to throughput and capped', () => {
    expect(dotCount(0)).toBe(0);
    expect(dotCount(5)).toBe(1);
    expect(dotCount(240)).toBe(2);
    expect(dotCount(1_000_000)).toBe(6);
    const d = topology();
    const app = d.nodes.find((n) => n.type === 'app')!; const db = d.nodes.find((n) => n.type === 'mysql')!;
    expect(edgeFlow({ source: app.id, target: db.id }, { [db.id]: { tps: 300 } })).toBe(300);
    expect(edgeFlow({ source: app.id, target: db.id }, undefined)).toBe(0);
  });
});

describe('auto layout', () => {
  it('lays out left to right along edges, snapped to the grid, without overlap', () => {
    const d = topology();
    const pos = autoLayout(d);
    const x = (t: string) => pos[d.nodes.find((n) => n.type === t)!.id]!.x;
    expect(x('users')).toBeLessThan(x('lb'));
    expect(x('lb')).toBeLessThan(x('app'));
    expect(x('app')).toBeLessThan(x('mysql'));
    for (const p of Object.values(pos)) { expect(p.x % 16).toBe(0); expect(p.y % 16).toBe(0); }
    const list = Object.values(pos);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const overlap = Math.abs(list[i]!.x - list[j]!.x) < NODE_W && Math.abs(list[i]!.y - list[j]!.y) < NODE_H;
      expect(overlap).toBe(false);
    }
  });

  it('falls back to type columns when there are no links', () => {
    const d = emptyDesign();
    for (const t of ['mysql', 'users', 'app'] as const) addNode(d, t);
    const pos = autoLayout(d);
    const x = (t: string) => pos[d.nodes.find((n) => n.type === t)!.id]!.x;
    expect(x('users')).toBeLessThan(x('app'));
    expect(x('app')).toBeLessThan(x('mysql'));
  });

  it('handles an empty design', () => { expect(autoLayout(emptyDesign())).toEqual({}); });
});

describe('design mutators and summaries', () => {
  it('quick selectors mirror node config', () => {
    const d = topology();
    addNode(d, 'app');
    expect(currentStrategy(d)).toBe('default');
    setStrategy(d, 'atomic');
    expect(d.nodes.filter((n) => n.type === 'app').every((n) => n.type === 'app' && n.config.strategy === 'atomic')).toBe(true);
    expect(currentStrategy(d)).toBe('atomic');
    setIsolation(d, 'SERIALIZABLE');
    expect(currentIsolation(d)).toBe('SERIALIZABLE');
    expect(currentStrategy(emptyDesign())).toBeNull();
  });

  it('summarises schema and workload', () => {
    const d = emptyDesign();
    expect(schemaSummary(d)).toEqual({ tables: 0, rows: 0, indexes: 0 });
    d.workload.transactions.push(
      { name: 'a', weight: 75, readOnly: false, cacheable: false, description: '', params: {}, variants: { default: [{ sql: 'select 1' }] } },
      { name: 'b', weight: 25, readOnly: true, cacheable: false, description: '', params: {}, variants: { default: [{ sql: 'select 1' }] } },
    );
    expect(workloadSummary(d)).toEqual([{ name: 'a', pct: 75, readOnly: false }, { name: 'b', pct: 25, readOnly: true }]);
  });
});

describe('problems helpers', () => {
  const d = topology();
  const app = d.nodes.find((n) => n.type === 'app')!;
  const probs = [
    { severity: 'warning' as const, code: 'W', message: 'w', path: { nodeId: app.id } },
    { severity: 'error' as const, code: 'E', message: 'e', path: { edgeId: d.edges[0]!.id } },
    { severity: 'error' as const, code: 'T', message: 't', path: { table: 'section', column: 'slot' } },
  ];
  it('marks worst severity per node, charging edge problems to both ends', () => {
    const h = healthByNode(probs, d);
    expect(h.get(app.id)).toBe('warning');
    expect(h.get(d.edges[0]!.source)).toBe('error');
    expect(h.get(d.edges[0]!.target)).toBe('error');
  });
  it('maps problems to jump targets and labels', () => {
    expect(problemTarget(probs[0]!)).toEqual({ kind: 'node', id: app.id });
    expect(problemTarget(probs[2]!)).toEqual({ kind: 'table', table: 'section' });
    expect(problemTarget({ severity: 'error', code: 'X', message: '', path: { txn: 'register', step: 1 } })).toEqual({ kind: 'workload' });
    expect(problemWhere(probs[2]!, d)).toBe('section.slot');
    expect(problemWhere(probs[0]!, d)).toBe(app.name);
  });
  it('merges server problems without duplicates, errors first', () => {
    const merged = mergeProblems([probs[0]!], [probs[0]!, probs[1]!]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.severity).toBe('error');
  });
});

// ---------------------------------------------------------------- run store reducers
const sample = (tS: number, nodes?: RunSample['nodes']): RunSample => ({
  tS, tps: 100, p50Ms: 5, p95Ms: 20, p99Ms: 40, errors: 0, activeVus: 10, appQueue: 0, poolWaiting: 0, threadsRunning: 2, rowLockWaits: 0, lockWaitMs: 0, bpHitRatio: null, cacheHitRatio: null, nodes,
});

describe('run store reducers', () => {
  it('begin resets everything and starts queued', () => {
    const s = begin('p1', 'r1', [], 1000);
    expect(s).toMatchObject({ projectId: 'p1', runId: 'r1', status: 'QUEUED', samples: [], report: null });
    expect(isActive(s)).toBe(true);
    expect(s.log).toHaveLength(1);
  });

  it('status and progress events drive the phase text', () => {
    let s = begin('p1', 'r1');
    s = applyStatus(s, { runId: 'r1', status: 'PROVISIONING', phase: 'Provisioning sandbox' });
    s = applyProgress(s, { runId: 'r1', table: 'student', rows: 20000, totalRows: 20000, doneRows: 42000, allRows: 100000 });
    expect(describePhase(s)).toBe('Provisioning sandbox · 42,000 / 100,000 rows');
    expect(phaseIndex(s.status)).toBe(0);
    s = applyStatus(s, { runId: 'r1', status: 'WARMING', phase: 'Warm-up', elapsedS: 2, totalS: 3 });
    expect(s.provision).toBeNull();
    expect(describePhase(s)).toBe('Warm-up 2/3 s');
    s = applyStatus(s, { runId: 'r1', status: 'RUNNING', phase: 'Measuring', elapsedS: 12, totalS: 20 });
    expect(describePhase(s)).toBe('Measuring 12/20 s');
    expect(phaseFill(s, 0)).toBe(1);
    expect(phaseFill(s, 1)).toBe(1);
    expect(phaseFill(s, 2)).toBeCloseTo(0.6);
    expect(phaseFill(s, 3)).toBe(0);
    s = applyStatus(s, { runId: 'r1', status: 'ANALYZING', phase: 'Analyzing' });
    expect(describePhase(s)).toBe('Analyzing');
  });

  it('capacity steps show their step prefix', () => {
    const s = applyStatus(begin('p', 'r'), { runId: 'r', status: 'RUNNING', phase: 'Measuring', elapsedS: 4, totalS: 10, step: { n: 2, of: 5, vus: 25 } });
    expect(describePhase(s)).toBe('Step 2/5 · 25 VUs · Measuring 4/10 s');
  });

  it('ignores events for other runs', () => {
    const s = begin('p1', 'r1');
    expect(applyStatus(s, { runId: 'other', status: 'RUNNING', phase: 'x' })).toBe(s);
    expect(applyLocks(s, { runId: 'other', edges: [] })).toBe(s);
    expect(applyFinished(s, { runId: 'other', status: 'COMPLETED', sloPass: true })).toBe(s);
  });

  it('keeps a ring buffer and the newest per-node metrics', () => {
    let s = begin('p', 'r');
    s = appendSamples(s, [sample(1, { a: { tps: 1 } }), sample(2, { a: { tps: 2 } })]);
    expect(s.liveNodes).toEqual({ a: { tps: 2 } });
    expect(appendSamples(s, [])).toBe(s);
    const many = Array.from({ length: RING_CAP + 50 }, (_, i) => sample(i));
    s = appendSamples(s, many);
    expect(s.samples).toHaveLength(RING_CAP);
    expect(s.samples[s.samples.length - 1]!.tS).toBe(RING_CAP + 49);
    expect(s.liveNodes).toEqual({ a: { tps: 2 } }); // later batch had no node metrics
  });

  it('finish clears live state and logs the verdict', () => {
    let s = appendSamples(begin('p', 'r'), [sample(1, { a: { tps: 1 } })]);
    s = applyLocks(s, { runId: 'r', edges: [{ waiting: 'a', blocking: 'b', table: 't', mode: 'X' }] });
    expect(s.locks).toHaveLength(1);
    s = applyFinished(s, { runId: 'r', status: 'COMPLETED', sloPass: false }, 5000);
    expect(isActive(s)).toBe(false);
    expect(s.liveNodes).toEqual({});
    expect(s.locks).toEqual([]);
    expect(s.log[s.log.length - 1]).toMatchObject({ text: 'Run completed · SLO fail', tone: 'bad' });
  });

  it('a report replaces the live buffer with the persisted samples and keeps the log', () => {
    let s = appendSamples(begin('p', 'r'), [sample(-2), sample(-1), sample(1)]);
    const report = { run: { runId: 'r', status: 'COMPLETED', kind: 'LOAD', strategy: 'naive', vus: 10, startedAt: null, finishedAt: null, errorText: null }, samples: [sample(1), sample(2)] } as unknown as RunReport;
    s = applyReport(s, report);
    expect(s.samples.map((x) => x.tS)).toEqual([1, 2]);
    expect(s.report).toBe(report);
    expect(s.log.length).toBeGreaterThan(0);
  });

  it('opening a past run synthesises a log from the summary', () => {
    const report = { run: { runId: 'old', status: 'FAILED', kind: 'LOAD', strategy: 'naive', vus: 10, startedAt: '2026-10-12T10:00:00Z', finishedAt: '2026-10-12T10:00:05Z', errorText: 'boom' }, samples: [] } as unknown as RunReport;
    const s = applyReport(initialRunState(), report, 'p');
    expect(s.runId).toBe('old');
    expect(s.log.map((l) => l.text)).toEqual(['Run started · load · naive · 10 VUs', 'Run failed: boom']);
  });

  it('strategy comparison accepts child runs and restarts the charts per child', () => {
    let s = begin('p', 'parent', ['c1', 'c2']);
    s = applyStatus(s, { runId: 'c1', status: 'RUNNING', phase: 'Measuring', elapsedS: 1, totalS: 10 });
    s = appendSamples(s, [sample(1)]);
    s = applyStatus(s, { runId: 'c1', status: 'RUNNING', phase: 'Measuring', elapsedS: 2, totalS: 10 });
    expect(s.samples).toHaveLength(1);
    s = applyStatus(s, { runId: 'c2', status: 'RUNNING', phase: 'Measuring', elapsedS: 1, totalS: 10 });
    expect(s.samples).toHaveLength(0);
    expect(s.currentChild).toBe('c2');
    expect(applyStatus(s, { runId: 'stranger', status: 'RUNNING', phase: 'x' })).toBe(s);
  });
});

describe('throttled sample buffer', () => {
  it('delivers a burst as one batch at most every interval', () => {
    vi.useFakeTimers();
    const push = vi.fn();
    const buf = createSampleBuffer(push, 500);
    buf.add(sample(1)); buf.add(sample(2)); buf.add(sample(3));
    expect(push).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(push).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![0]).toHaveLength(3);
    buf.add(sample(4));
    buf.flush();
    expect(push).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(push).toHaveBeenCalledTimes(2); // flush cancelled the pending timer
    buf.add(sample(5)); buf.cancel();
    vi.advanceTimersByTime(1000);
    expect(push).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
