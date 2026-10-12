import { describe, expect, it } from 'vitest';
import { DesignDoc, type Finding, type RunReport } from '@datasim/shared';
import { compareValue, diffDesigns, diffFindings, diffRuns, findingKey, formatDelta, invariantMatrix, overlaySeries, runLabels } from './diff';

const design = (patch: (d: DesignDoc) => void = () => undefined): DesignDoc => {
  const d = DesignDoc.parse({
    nodes: [
      { id: 'u', type: 'users', name: 'Students', position: { x: 0, y: 0 }, config: { vus: 100 } },
      { id: 'a', type: 'app', name: 'App', position: { x: 1, y: 0 }, config: { instances: 2, poolSize: 16 } },
      { id: 'db', type: 'mysql', name: 'MySQL', position: { x: 2, y: 0 }, config: {} },
    ],
    edges: [{ id: 'e1', source: 'u', target: 'a', latencyMs: 2 }],
    schema: { tables: [{ name: 'section', columns: [{ name: 'section_id', type: { kind: 'INT', unsigned: false } }, { name: 'slot', type: { kind: 'VARCHAR', length: 12 } }], primaryKey: ['section_id'] }] },
    workload: { transactions: [{ name: 'register', weight: 50, variants: { default: [{ sql: 'SELECT 1' }] } }], invariants: [{ name: 'no_overbooking', sql: 'SELECT 0' }] },
  });
  patch(d);
  return d;
};

const finding = (over: Partial<Finding>): Finding => ({ findingNo: 1, severity: 'HIGH', kind: 'OTHER', title: 't', explanation: '', evidence: {}, fix: null, ...over });
const report = (over: { design?: DesignDoc; run?: Record<string, unknown>; findings?: Finding[]; invariants?: RunReport['invariants']; samples?: RunReport['samples']; settings?: Record<string, unknown> } = {}): RunReport => ({
  run: { runId: 'aaaa1111', projectId: 'p', revisionNo: 1, kind: 'LOAD', status: 'COMPLETED', strategy: 'naive', isolation: 'REPEATABLE READ', vus: 100, durationS: 10, seed: 1, tpsAvg: 100, p50Ms: 10, p95Ms: 100, p99Ms: 200, txnTotal: 1000, committed: 900, rejected: 100, errored: 0, retries: 0, deadlocks: 0, invariantViolations: 0, ...over.run } as RunReport['run'],
  settings: over.settings ?? {}, design: over.design ?? design(), samples: over.samples ?? [], txnStats: [], statementStats: [], lockWaits: [], invariants: over.invariants ?? [], findings: over.findings ?? [], slo: null, bottleneck: null, capacity: null, cacheHitRatio: null,
});

describe('compareValue', () => {
  it('is direction aware', () => {
    expect(compareValue(100, 80, 'lower').verdict).toBe('better'); // p95 down
    expect(compareValue(100, 120, 'lower').verdict).toBe('worse');
    expect(compareValue(100, 120, 'higher').verdict).toBe('better'); // tps up
    expect(compareValue(100, 80, 'higher').verdict).toBe('worse');
  });
  it('treats <1% as same, neutral as uncoloured, missing as none', () => {
    expect(compareValue(1000, 1005, 'higher').verdict).toBe('same');
    expect(compareValue(100, 150, 'neutral').verdict).toBe('none');
    expect(compareValue(null, 3, 'lower').verdict).toBe('none');
  });
  it('handles a zero baseline (violations 0 -> 93)', () => {
    const d = compareValue(0, 93, 'lower');
    expect(d.verdict).toBe('worse');
    expect(d.pct).toBeNull();
    expect(formatDelta(d)).toBe('+93');
  });
});

describe('formatDelta', () => {
  it('formats percentages with sign', () => {
    expect(formatDelta(compareValue(200, 250, 'higher'))).toBe('+25.0%');
    expect(formatDelta(compareValue(200, 100, 'lower'))).toBe('-50.0%');
    expect(formatDelta(compareValue(5, 5, 'lower'))).toBe('=');
    expect(formatDelta(compareValue(null, 5, 'lower'))).toBe('');
  });
  it('uses ms units for a zero baseline in latency', () => {
    expect(formatDelta(compareValue(0, 12, 'lower'), 'ms')).toBe('+12 ms');
  });
});

describe('runLabels', () => {
  it('labels strategy and revision, disambiguating duplicates', () => {
    expect(runLabels([report({ run: { strategy: 'naive', revisionNo: 3 } }), report({ run: { strategy: 'atomic', revisionNo: 3, runId: 'bbbb' } })])).toEqual(['naive · rev 3', 'atomic · rev 3']);
    const dup = runLabels([report(), report({ run: { runId: 'cccc2222' } })]);
    expect(dup[0]).toBe('naive · rev 1 · aaaa');
    expect(dup[1]).toBe('naive · rev 1 · cccc');
  });
});

describe('diffDesigns', () => {
  it('is empty for identical designs', () => expect(diffDesigns(design(), design())).toEqual([]));

  it('detects topology config, node and link changes', () => {
    const b = design((d) => {
      const app = d.nodes.find((n) => n.id === 'a')!;
      if (app.type === 'app') app.config.poolSize = 32;
      d.nodes.push({ id: 'r', type: 'redis', name: 'Cache', position: { x: 0, y: 0 }, config: { ttlS: 30 } });
      d.edges[0]!.latencyMs = 5;
    });
    const out = diffDesigns(design(), b);
    expect(out).toContainEqual({ area: 'Topology', kind: 'changed', label: 'App.poolSize', before: '16', after: '32' });
    expect(out).toContainEqual({ area: 'Topology', kind: 'added', label: 'node redis', after: 'Cache' });
    expect(out).toContainEqual({ area: 'Topology', kind: 'changed', label: 'link Students -> App.latencyMs', before: '2', after: '5' });
  });

  it('detects schema changes: index added, column added/removed, table added', () => {
    const b = design((d) => {
      const t = d.schema.tables[0]!;
      t.indexes.push({ name: 'ix_section_slot', columns: ['slot'], unique: false });
      t.columns.push({ name: 'room', type: { kind: 'VARCHAR', length: 8 }, nullable: true, autoIncrement: false });
      d.schema.tables.push({ name: 'room', columns: [{ name: 'room_id', type: { kind: 'INT', unsigned: false }, nullable: false, autoIncrement: false }], primaryKey: ['room_id'], uniques: [], indexes: [], foreignKeys: [], checks: [], seedRows: 0 });
    });
    const out = diffDesigns(design(), b);
    expect(out).toContainEqual({ area: 'Schema', kind: 'added', label: '`section` index', after: 'ix_section_slot (slot)' });
    expect(out).toContainEqual({ area: 'Schema', kind: 'added', label: '`section` column', after: 'room VARCHAR(8)' });
    expect(out).toContainEqual({ area: 'Schema', kind: 'added', label: 'table', after: 'room (1 columns)' });
    const back = diffDesigns(b, design());
    expect(back.some((e) => e.kind === 'removed' && e.label === '`section` index')).toBe(true);
    expect(back.some((e) => e.kind === 'removed' && e.label === 'table')).toBe(true);
  });

  it('detects column type changes', () => {
    const b = design((d) => { d.schema.tables[0]!.columns[1]!.type = { kind: 'VARCHAR', length: 24 }; });
    expect(diffDesigns(design(), b)).toContainEqual({ area: 'Schema', kind: 'changed', label: '`section`.slot.type', before: 'VARCHAR(12)', after: 'VARCHAR(24)' });
  });

  it('detects workload and SLO changes', () => {
    const b = design((d) => {
      d.workload.transactions[0]!.weight = 70;
      d.workload.transactions[0]!.variants.atomic = [{ sql: 'UPDATE x' }];
      d.workload.invariants.push({ name: 'extra', description: '', sql: 'SELECT 0' });
      d.slo.p95Ms = 150;
    });
    const out = diffDesigns(design(), b);
    expect(out).toContainEqual({ area: 'Workload', kind: 'changed', label: 'register.weight', before: '50', after: '70' });
    expect(out).toContainEqual({ area: 'Workload', kind: 'added', label: 'register variant', after: 'atomic' });
    expect(out).toContainEqual({ area: 'Workload', kind: 'added', label: 'invariant', after: 'extra' });
    expect(out).toContainEqual({ area: 'SLO', kind: 'changed', label: 'slo.p95Ms', before: '200', after: '150' });
  });
});

describe('diffRuns', () => {
  it('reports strategy overrides on the same revision and skips the design diff', () => {
    const out = diffRuns(report(), report({ run: { strategy: 'atomic' }, design: design((d) => { d.slo.p95Ms = 1; }) }));
    expect(out).toEqual([{ area: 'Run settings', kind: 'changed', label: 'strategy', before: 'naive', after: 'atomic' }]);
  });
  it('includes the design diff across revisions', () => {
    const out = diffRuns(report(), report({ run: { revisionNo: 2 }, design: design((d) => { d.slo.p95Ms = 1; }) }));
    expect(out.map((e) => e.area)).toEqual(['Run settings', 'SLO']);
  });
});

describe('findings and invariants', () => {
  const idx = finding({ kind: 'FULL_SCAN', severity: 'MEDIUM', title: 'Full table scan on section', fix: { type: 'ADD_INDEX', table: 'section', columns: ['slot'], name: 'ix' } });
  const naive = (n: number) => finding({ kind: 'INVARIANT_NAIVE', title: `Invariant violated under the naive strategy: no_overbooking (${n})` });
  it('keys ignore numbers in titles and key order in fixes', () => {
    expect(findingKey(naive(17))).toBe(findingKey(naive(3)));
    expect(findingKey(idx)).toBe(findingKey({ ...idx, fix: { name: 'ix', columns: ['slot'], table: 'section', type: 'ADD_INDEX' } }));
  });
  it('marks resolved and new findings against the first run', () => {
    const rows = diffFindings([report({ findings: [naive(17), idx] }), report({ findings: [idx, finding({ kind: 'SLO', title: 'SLO not met', severity: 'LOW' })] })]);
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
    expect(byKind.INVARIANT_NAIVE!.status).toEqual(['base', 'resolved']);
    expect(byKind.SLO!.status).toEqual(['absent', 'new']);
    expect(byKind.FULL_SCAN!.status).toEqual(['base', 'same']);
    expect(rows[rows.length - 1]!.kind).toBe('FULL_SCAN'); // identical rows sort last
  });
  it('builds the invariant matrix across runs', () => {
    const a = report({ invariants: [{ name: 'x', sql: '', violations: 3, passed: false }] });
    const b = report({ invariants: [{ name: 'x', sql: '', violations: 0, passed: true }, { name: 'y', sql: '', violations: 0, passed: true }] });
    const m = invariantMatrix([a, b]);
    expect(m.map((r) => r.name)).toEqual(['x', 'y']);
    expect(m[0]!.cells[0]!.violations).toBe(3);
    expect(m[1]!.cells[0]).toBeNull();
  });
});

describe('overlaySeries', () => {
  it('merges runs by tS', () => {
    const s = (tS: number, tps: number) => ({ tS, tps, p50Ms: 0, p95Ms: 0, p99Ms: 0, errors: 0, activeVus: 0, appQueue: 0, poolWaiting: 0, threadsRunning: 0, rowLockWaits: 0, lockWaitMs: 0, bpHitRatio: null, cacheHitRatio: null });
    const rows = overlaySeries([report({ samples: [s(1, 10), s(2, 20)] }), report({ samples: [s(2, 5), s(3, 7)] })], (x) => x.tps);
    expect(rows).toEqual([{ tS: 1, r0: 10 }, { tS: 2, r0: 20, r1: 5 }, { tS: 3, r1: 7 }]);
  });
});
