import { describe, expect, it } from 'vitest';
import { emptyDesign, type RunSummary } from '@datasim/shared';
import { compareHeadline, compareRows, comparableIds, isCompareReport } from './compare';
import { invalidTargets, resolveDrop } from './connect';
import { addNode, newEdge } from './nodes';
import { defaultPanelHeight } from './studioUi';

function design() {
  const d = emptyDesign();
  for (const t of ['users', 'lb', 'app', 'mysql'] as const) addNode(d, t);
  return d;
}
const id = (d: ReturnType<typeof design>, t: string) => d.nodes.find((n) => n.type === t)!.id;

describe('connection drop anywhere on a node (resolveDrop)', () => {
  const d = design();
  it('ignores a release over nothing or over the origin node', () => {
    expect(resolveDrop(d, id(d, 'users'), 'source', null)).toBeNull();
    expect(resolveDrop(d, id(d, 'users'), 'source', id(d, 'users'))).toBeNull();
  });
  it('returns the reason for an illegal pair', () => {
    const r = resolveDrop(d, id(d, 'users'), 'source', id(d, 'mysql'))!;
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) expect(r.result.reason).toMatch(/Users cannot connect to Database/);
  });
  it('accepts a legal pair and reverses it when the drag started on a target handle', () => {
    expect(resolveDrop(d, id(d, 'users'), 'source', id(d, 'lb'))).toMatchObject({ source: id(d, 'users'), target: id(d, 'lb'), result: { ok: true } });
    expect(resolveDrop(d, id(d, 'mysql'), 'target', id(d, 'app'))).toMatchObject({ source: id(d, 'app'), target: id(d, 'mysql'), result: { ok: true } });
  });
  it('rejects a duplicate link', () => {
    const e = design();
    e.edges.push(newEdge(e, id(e, 'users'), id(e, 'lb')));
    expect(resolveDrop(e, id(e, 'users'), 'source', id(e, 'lb'))!.result.ok).toBe(false);
  });
  it('lists the nodes to dim while dragging', () => {
    const bad = invalidTargets(d, id(d, 'users'), 'source');
    expect([...bad]).toEqual([id(d, 'mysql')]);
  });
});

describe('default bottom panel height', () => {
  it('is about a third of short viewports and capped on tall ones', () => {
    expect(defaultPanelHeight(720)).toBe(259);
    expect(defaultPanelHeight(900)).toBe(300);
    expect(defaultPanelHeight(400)).toBe(160);
  });
});

const child = (runId: string, strategy: string, status: RunSummary['status'], tpsAvg = 0, p95Ms = 0): RunSummary => ({ runId, strategy, status, tpsAvg, p95Ms, invariantViolations: 0 } as RunSummary);

describe('strategy comparison progress', () => {
  it('flags the parent run from its settings', () => {
    expect(isCompareReport({ settings: { kind: 'compare-strategies' } })).toBe(true);
    expect(isCompareReport({ settings: {} })).toBe(false);
    expect(isCompareReport(null)).toBe(false);
  });
  it('marks finished, running and pending variants in order', () => {
    const rows = compareRows({
      variants: ['naive', 'pessimistic', 'atomic'], childIds: ['c1', 'c2', 'c3'], currentChild: 'c2', final: [],
      summaries: [child('c1', 'naive', 'COMPLETED', 263, 675), child('c2', 'pessimistic', 'RUNNING')],
    });
    expect(rows.map((r) => r.state)).toEqual(['done', 'running', 'pending']);
    expect(rows[0]).toMatchObject({ tpsAvg: 263, p95Ms: 675 });
    expect(rows[1]!.tpsAvg).toBeNull();
    expect(compareHeadline(rows, { n: 2, of: 3 })).toBe('Comparing strategies · step 2/3 · pessimistic');
    expect(compareHeadline(rows, null)).toBe('Comparing strategies · step 2/3 · pessimistic');
    expect(comparableIds(rows)).toEqual(['c1']);
  });
  it('reads a finished parent from its stored children, matching by strategy when ids are unknown', () => {
    const rows = compareRows({
      variants: ['naive', 'atomic'], childIds: [], currentChild: null, summaries: [],
      final: [{ runId: 'a', strategy: 'naive', tpsAvg: 10, p95Ms: 5, invariantViolations: 3 }, { runId: 'b', strategy: 'atomic', tpsAvg: 20, p95Ms: 4, invariantViolations: 0 }],
    });
    expect(rows.map((r) => [r.runId, r.state, r.violations])).toEqual([['a', 'done', 3], ['b', 'done', 0]]);
    expect(comparableIds(rows)).toEqual(['a', 'b']);
  });
  it('shows cancelled and failed children as such', () => {
    const rows = compareRows({ variants: ['x', 'y'], childIds: ['1', '2'], currentChild: null, final: [], summaries: [child('1', 'x', 'CANCELLED'), child('2', 'y', 'FAILED')] });
    expect(rows.map((r) => r.state)).toEqual(['cancelled', 'failed']);
  });
});
