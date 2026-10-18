import { describe, expect, it } from 'vitest';
import { uslThroughput, type CapacityFit, type CapacityPoint, type LockWaitRow, type RunReport } from '@datasim/shared';
import { aggregateLockWaits, buildKpis, capacityCurve, evidenceChips, evidenceNumber, explainTables, hasFinitePeak, layoutNodes, littleLine, rerunOverrides, waitGraph } from './logic';

const pts: CapacityPoint[] = [10, 25, 50, 100].map((vus, i) => ({ stepNo: i + 1, vus, tps: 100 * vus / (1 + 0.02 * (vus - 1)), p50Ms: 10, p95Ms: 20 + vus, errorRate: 0 }));
const fit: CapacityFit = { lambda: 100, sigma: 0.02, kappa: 0.0002, nPeak: Math.sqrt(0.98 / 0.0002), xMax: 0, r2: 0.99 };

describe('capacityCurve', () => {
  it('draws the fit solid up to the largest tested N and projected beyond, touching at the boundary', () => {
    const { rows, maxTested, end } = capacityCurve(pts, fit);
    expect(maxTested).toBe(100);
    expect(end).toBeGreaterThanOrEqual(150);
    const boundary = rows.find((r) => r.n === 100)!;
    expect(boundary.fit).toBeCloseTo(uslThroughput(100, fit));
    expect(boundary.proj).toBeCloseTo(boundary.fit!);
    expect(rows.filter((r) => r.n < 100).every((r) => r.proj === undefined)).toBe(true);
    expect(rows.filter((r) => r.n > 100).every((r) => r.fit === undefined && r.proj !== undefined)).toBe(true);
    expect(rows.every((r, i) => i === 0 || rows[i - 1]!.n < r.n)).toBe(true);
  });
  it('keeps the measured points exactly and extends past the peak N* when it is near', () => {
    const { rows, end } = capacityCurve(pts, fit);
    expect(rows.find((r) => r.n === 25)!.tps).toBeCloseTo(pts[1]!.tps);
    expect(end).toBeGreaterThanOrEqual(Math.ceil(fit.nPeak! * 1.25));
  });
  it('returns only measured rows without a fit', () => {
    const { rows } = capacityCurve(pts, null);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.fit === undefined && r.proj === undefined)).toBe(true);
  });
  it('flags only a reachable peak as finite', () => {
    expect(hasFinitePeak(fit, 100)).toBe(true);
    expect(hasFinitePeak({ ...fit, nPeak: 1e6 }, 100)).toBe(false);
    expect(hasFinitePeak(null, 100)).toBe(false);
  });
});

const lock = (seq: number, waiting: string, blocking: string, table = 'section'): LockWaitRow => ({ seq, atMs: seq, waitingTxn: waiting, blockingTxn: blocking, tableName: table, indexName: 'PRIMARY', lockMode: 'X,REC_NOT_GAP', lockData: '1' });
describe('lock waits', () => {
  const rows = [lock(0, 'register', 'register'), lock(1, 'register', 'register'), lock(2, 'register', 'my_timetable'), lock(3, 'a', 'b', 'enrollment')];
  it('aggregates identical rows into counts, most frequent first', () => {
    const agg = aggregateLockWaits(rows);
    expect(agg[0]).toMatchObject({ waiting: 'register', blocking: 'register', count: 2 });
    expect(agg).toHaveLength(3);
  });
  it('builds a wait-for graph (waiting -> blocking) with unique nodes', () => {
    const g = waitGraph(rows);
    expect(g.edges[0]).toMatchObject({ from: 'register', to: 'register', count: 2, table: 'section' });
    expect(g.nodeIds.sort()).toEqual(['a', 'b', 'my_timetable', 'register']);
  });
  it('lays nodes out inside the canvas', () => {
    for (const n of [1, 2, 3, 6]) {
      const ids = Array.from({ length: n }, (_, i) => `t${i}`);
      for (const p of layoutNodes(ids, 400, 220)) { expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(400); expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(220); }
    }
  });
});

describe('explainTables', () => {
  it('lists table accesses in plan order, flagging full scans', () => {
    const plan = { query_block: { nested_loop: [{ table: { table_name: 'section', access_type: 'ALL', rows_examined_per_scan: 1200, filtered: '10.00', cost_info: { prefix_cost: '121.00' } } }, { table: { table_name: 'course', access_type: 'eq_ref', key: 'PRIMARY' } }] } };
    const t = explainTables(plan);
    expect(t.map((x) => x.table)).toEqual(['section', 'course']);
    expect(t[0]).toMatchObject({ access: 'ALL', rows: 1200, cost: '121.00' });
    expect(t[1]!.key).toBe('PRIMARY');
    expect(explainTables(null)).toEqual([]);
  });
});

describe('evidenceChips', () => {
  it('keeps short facts and drops SQL, digests and nested data', () => {
    const chips = evidenceChips({ table: 'section', accessType: 'ALL', statement: 'SELECT ...', digest: 'abc', rowsExaminedPerExec: 1392, filterColumns: ['slot'], waiting: { register: 1163 }, nested: { a: { b: 1 } }, shareOfWaits: 0.843 });
    expect(chips).toContainEqual({ label: 'rows examined per exec', value: '1,392' });
    expect(chips).toContainEqual({ label: 'filter columns', value: 'slot' });
    expect(chips).toContainEqual({ label: 'waiting', value: 'register 1,163' });
    expect(chips.map((c) => c.label)).not.toContain('statement');
    expect(chips.map((c) => c.label)).not.toContain('nested');
  });
});

describe('evidenceNumber', () => {
  it('shows shares and ratios as percentages and R^2 with 2 decimals', () => {
    expect(evidenceNumber('bufferPoolHitRatio', 0.995)).toBe('99.5%');
    expect(evidenceNumber('shareOfWaits', 0.843)).toBe('84.3%');
    expect(evidenceNumber('cacheHitRate', 0.5)).toBe('50%');
    expect(evidenceNumber('r2', 0.97123)).toBe('0.97');
  });
  it('leaves other numbers alone', () => {
    expect(evidenceNumber('rowsExaminedPerExec', 1392)).toBe('1,392');
    expect(evidenceNumber('avgMs', 3.14159)).toBe('3.142');
    expect(evidenceNumber('ratioOverOne', 2.5)).toBe('2.5');
    expect(evidenceNumber('waitRatio', 1)).toBe('1');
  });
});

describe('rerunOverrides', () => {
  const settings = { overrides: { vus: 40, durationS: 6, strategy: 'naive' } };
  it('keeps the stored overrides', () => expect(rerunOverrides(settings, { type: 'ADD_INDEX', table: 't', columns: ['c'], name: 'ix' })).toEqual({ vus: 40, durationS: 6, strategy: 'naive' }));
  it('switches the strategy for SET_STRATEGY and does not mutate the settings', () => {
    expect(rerunOverrides(settings, { type: 'SET_STRATEGY', strategy: 'atomic' })).toEqual({ vus: 40, durationS: 6, strategy: 'atomic' });
    expect(settings.overrides.strategy).toBe('naive');
  });
  it('tolerates missing overrides', () => expect(rerunOverrides({})).toEqual({}));
});

describe('buildKpis', () => {
  const base = {
    run: { tpsAvg: 660.4, p50Ms: 43, p95Ms: 350.9, p99Ms: 623, txnTotal: 1000, committed: 800, rejected: 200, errored: 0, retries: 5, deadlocks: 2, lockTimeouts: 0, invariantViolations: 93 },
    design: { slo: { p95Ms: 200, maxErrorPct: 1 } }, invariants: [{ passed: false }, { passed: true }], cacheHitRatio: 0.754,
  } as unknown as RunReport;
  const k = (r: RunReport) => Object.fromEntries(buildKpis(r).map((x) => [x.key, x]));
  it('formats values and flags SLO breaches, deadlocks and violations', () => {
    const m = k(base);
    expect(m.tps!.value).toBe('660');
    expect(m.p95!.value).toBe('351 ms');
    expect(m.p95!.tone).toBe('red');
    expect(m.committed!.sub).toContain('80.0%');
    expect(m.deadlocks!.tone).toBe('amber');
    expect(m.violations!.tone).toBe('red');
    expect(m.violations!.sub).toBe('1 of 2 invariants failing');
    expect(m.cache!.value).toBe('75.4%');
    expect(buildKpis(base)).toHaveLength(10);
  });
  it('shows a dash for a design without a cache and green when the invariants pass', () => {
    const m = k({ ...base, cacheHitRatio: null, run: { ...base.run, invariantViolations: 0, p95Ms: 120 } } as RunReport);
    expect(m.cache!.value).toBe('-');
    expect(m.p95!.tone).toBe('green');
    expect(m.violations!.tone).toBe('green');
  });
});

describe('littleLine', () => {
  it('is ok within 15% of configured VUs', () => {
    expect(littleLine({ vus: 50, predicted: 49.2, ratio: 0.98 }).ok).toBe(true);
    expect(littleLine({ vus: 50, predicted: 80, ratio: 1.6 }).ok).toBe(false);
  });
});
