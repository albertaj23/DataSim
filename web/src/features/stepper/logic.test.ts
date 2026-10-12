import { describe, expect, it } from 'vitest';
import type { StepResultView, StepperStateView, TxnLabel, TxnView, WaitRow } from '../../lib/labApi';
import {
  applyStepResponse, buildWaitGraph, canRunStep, cycleEdgeKeys, deadlockInfo, edgesFromWaits, graphCaption, layoutWaitGraph, mergeUpdate,
  nextSuggested, rowsPreview, txnPhase,
} from './logic';

const step = (index: number, over: Partial<StepResultView> = {}): StepResultView => ({ index, display: `s${index}`, status: 'PENDING', ...over });
const txn = (label: TxnLabel, over: Partial<TxnView> = {}): TxnView => ({
  label, connId: 1, isolation: 'READ COMMITTED', killed: false, busy: false, cursor: 0, steps: [step(0), step(1), step(2)], ...over,
});
const state = (t1: Partial<TxnView> = {}, t2: Partial<TxnView> = {}): StepperStateView => ({
  scenarioId: 'X', accountIds: [1], txns: { T1: txn('T1', t1), T2: txn('T2', t2) },
});
const wait = (a: 'T1' | 'T2' | 'other', b: 'T1' | 'T2' | 'other'): WaitRow => ({ waitingConn: 1, waitingLabel: a, blockingConn: 2, blockingLabel: b });

describe('stepper state', () => {
  it('mergeUpdate settles a WAITING step and advances the cursor', () => {
    const s = state({ busy: true, cursor: 1, steps: [step(0, { status: 'DONE' }), step(1, { status: 'WAITING' }), step(2)] });
    const next = mergeUpdate(s, { txn: 'T1', index: 1, result: step(1, { status: 'DONE', affectedRows: 1 }) });
    expect(next.txns.T1.steps[1]!.status).toBe('DONE');
    expect(next.txns.T1.busy).toBe(false);
    expect(next.txns.T1.cursor).toBe(2);
  });

  it('mergeUpdate handles kill pushes', () => {
    const next = mergeUpdate(state(), { txn: 'T2', index: -1, result: null, killed: true });
    expect(next.txns.T2.killed).toBe(true);
    expect(next.txns.T2.connId).toBeNull();
  });

  it('a late WAITING response does not overwrite a pushed final result', () => {
    const s = state({ cursor: 2, steps: [step(0, { status: 'DONE' }), step(1, { status: 'ERROR', errno: 1213 }), step(2)] });
    expect(applyStepResponse(s, 'T1', step(1, { status: 'WAITING' }))).toBe(s);
    const fresh = applyStepResponse(state(), 'T1', step(0, { status: 'WAITING' }));
    expect(fresh.txns.T1.busy).toBe(true);
    expect(fresh.txns.T1.cursor).toBe(1);
  });

  it('canRunStep only allows the cursor step of an idle, live transaction', () => {
    const t = txn('T1', { cursor: 1, steps: [step(0, { status: 'DONE' }), step(1), step(2)] });
    expect(canRunStep(t, 1, false)).toBe(true);
    expect(canRunStep(t, 2, false)).toBe(false);
    expect(canRunStep(t, 0, false)).toBe(false);
    expect(canRunStep(t, 1, true)).toBe(false);
    expect(canRunStep({ ...t, busy: true }, 1, false)).toBe(false);
    expect(canRunStep({ ...t, killed: true }, 1, false)).toBe(false);
  });

  it('txnPhase summarizes a transaction', () => {
    expect(txnPhase(txn('T1'))).toBe('idle');
    expect(txnPhase(txn('T1', { cursor: 1 }))).toBe('running');
    expect(txnPhase(txn('T1', { cursor: 3 }))).toBe('done');
    expect(txnPhase(txn('T1', { busy: true }))).toBe('waiting');
    expect(txnPhase(txn('T1', { steps: [step(0, { status: 'ERROR', errno: 1213 })] }))).toBe('error');
    expect(txnPhase(txn('T1', { killed: true }))).toBe('killed');
  });

  it('deadlockInfo finds the 1213 victim and its excerpt', () => {
    const s = state({}, { steps: [step(0), step(1, { status: 'ERROR', errno: 1213, deadlockText: 'LATEST DETECTED DEADLOCK' })] });
    expect(deadlockInfo(s)).toEqual({ victim: 'T2', text: 'LATEST DETECTED DEADLOCK' });
    expect(deadlockInfo(state())).toBeNull();
    expect(deadlockInfo(null)).toBeNull();
  });

  it('nextSuggested follows steps taken and kills', () => {
    const order = ['T1', 'T2', 'KILL_T1', 'T2'];
    expect(nextSuggested(order, state())).toBe('T1');
    expect(nextSuggested(order, state({ cursor: 1 }))).toBe('T2');
    expect(nextSuggested(order, state({ cursor: 1 }, { cursor: 1 }))).toBe('KILL_T1');
    expect(nextSuggested(order, state({ cursor: 1, killed: true }, { cursor: 1 }))).toBe('T2');
    expect(nextSuggested(order, state({ cursor: 3 }, { cursor: 3 }))).toBeNull();
    expect(nextSuggested(order, null)).toBe('T1');
  });

  it('rowsPreview limits rows and renders NULL', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: i, v: i === 0 ? null : 'x' }));
    const p = rowsPreview(rows)!;
    expect(p.columns).toEqual(['id', 'v']);
    expect(p.cells).toHaveLength(5);
    expect(p.cells[0]).toEqual(['0', 'NULL']);
    expect(p.more).toBe(2);
    expect(rowsPreview([])).toBeNull();
    expect(rowsPreview(undefined)).toBeNull();
  });
});

describe('wait-for graph', () => {
  it('edgesFromWaits dedupes and drops self loops', () => {
    expect(edgesFromWaits([wait('T1', 'T2'), wait('T1', 'T2'), wait('T2', 'T2')])).toEqual([{ from: 'T1', to: 'T2', inferred: false }]);
  });

  it('cycleEdgeKeys marks only edges on a cycle', () => {
    const k = cycleEdgeKeys([{ from: 'T1', to: 'T2' }, { from: 'T2', to: 'T1' }, { from: 'other', to: 'T1' }]);
    expect([...k].sort()).toEqual(['T1>T2', 'T2>T1']);
    expect(cycleEdgeKeys([{ from: 'T1', to: 'T2' }]).size).toBe(0);
  });

  it('a one-sided wait is not a cycle', () => {
    const g = buildWaitGraph([wait('T2', 'T1')], [], null);
    expect(g.cycle).toBe(false);
    expect(g.source).toBe('live');
    expect(graphCaption(g)).toBe('T2 waits for T1');
  });

  it('two live opposite waits are a cycle', () => {
    const g = buildWaitGraph([wait('T1', 'T2'), wait('T2', 'T1')], [], null);
    expect(g.cycle).toBe(true);
    expect(graphCaption(g)).toBe('Wait-for cycle: deadlock');
  });

  it('after a deadlock the closing edge is inferred from errno 1213 and the earlier edge is remembered', () => {
    const g = buildWaitGraph([], [wait('T1', 'T2')], 'T2');
    expect(g.cycle).toBe(true);
    expect(g.source).toBe('last-seen');
    const inferred = g.edges.filter((e) => e.inferred).map((e) => `${e.from}>${e.to}`);
    expect(inferred).toEqual(['T2>T1']);
    expect(graphCaption(g)).toMatch(/rolled back T2/);
  });

  it('nobody waiting gives an empty graph', () => {
    const g = buildWaitGraph([], [], null);
    expect(g.source).toBe('none');
    expect(graphCaption(g)).toBe('No one is waiting');
  });

  it('layout puts T1 left of T2 and bows opposite edges to opposite sides', () => {
    const g = buildWaitGraph([wait('T1', 'T2'), wait('T2', 'T1')], [], null);
    const l = layoutWaitGraph(g);
    const [t1, t2] = [l.nodes.find((n) => n.id === 'T1')!, l.nodes.find((n) => n.id === 'T2')!];
    expect(t1.x).toBeLessThan(t2.x);
    expect(l.nodes).toHaveLength(2);
    const [a, b] = l.edges;
    expect(a!.path).not.toBe(b!.path);
    expect(Math.sign(a!.labelY - t1.y)).toBe(-Math.sign(b!.labelY - t1.y));
    for (const e of l.edges) expect(e.path).toMatch(/^M [\d.]+ [\d.]+ Q [\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
  });

  it('layout adds the other node only when it appears in an edge', () => {
    const l = layoutWaitGraph(buildWaitGraph([wait('other', 'T1')], [], null));
    expect(l.nodes.map((n) => n.id)).toEqual(['T1', 'T2', 'other']);
  });
});
