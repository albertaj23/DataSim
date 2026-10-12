// Pure helpers for the Transaction Stepper: state merging, deadlock detection, the wait-for graph and its SVG layout.
import type {
  LockOwner, StepResultView, StepperStateView, StepperUpdate, TxnLabel, WaitRow,
} from '../../lib/labApi';

const FINAL = new Set(['DONE', 'ERROR', 'KILLED']);

// ---------------------------------------------------------------- state merging

function withStep(state: StepperStateView, txn: TxnLabel, result: StepResultView, busy: boolean): StepperStateView {
  const t = state.txns[txn];
  const steps = t.steps.map((s) => (s.index === result.index ? result : s));
  return { ...state, txns: { ...state.txns, [txn]: { ...t, steps, busy, cursor: Math.max(t.cursor, result.index + 1) } } };
}

/**
 * Applies a socket push. A step that was WAITING settles later, so this is how DONE / ERROR arrive.
 * `killed` pushes mark the transaction dead.
 */
export function mergeUpdate(state: StepperStateView, update: StepperUpdate): StepperStateView {
  const t = state.txns[update.txn];
  if (update.killed) return { ...state, txns: { ...state.txns, [update.txn]: { ...t, killed: true, busy: false, connId: null } } };
  if (!update.result) return state;
  return withStep(state, update.txn, update.result, false);
}

/**
 * Applies the HTTP response of a step. If the socket already delivered the final outcome of this step
 * (the push can beat a slow HTTP response), a late WAITING must not overwrite it.
 */
export function applyStepResponse(state: StepperStateView, txn: TxnLabel, result: StepResultView): StepperStateView {
  const current = state.txns[txn].steps.find((s) => s.index === result.index);
  if (current && FINAL.has(current.status) && result.status === 'WAITING') return state;
  return withStep(state, txn, result, result.status === 'WAITING');
}

// ---------------------------------------------------------------- derived facts

export const DEADLOCK_ERRNO = 1213;

/** The transaction InnoDB rolled back with errno 1213, and the excerpt of SHOW ENGINE INNODB STATUS captured then. */
export function deadlockInfo(state: StepperStateView | null): { victim: TxnLabel; text: string } | null {
  if (!state) return null;
  for (const label of ['T1', 'T2'] as const) {
    const hit = state.txns[label].steps.find((s) => s.errno === DEADLOCK_ERRNO);
    if (hit) return { victim: label, text: hit.deadlockText ?? '' };
  }
  return null;
}

export type TxnPhase = 'idle' | 'running' | 'waiting' | 'done' | 'error' | 'killed';

export function txnPhase(t: StepperStateView['txns'][TxnLabel]): TxnPhase {
  if (t.killed) return 'killed';
  if (t.busy || t.steps.some((s) => s.status === 'WAITING')) return 'waiting';
  if (t.steps.some((s) => s.status === 'ERROR')) return 'error';
  if (t.steps.length > 0 && t.cursor >= t.steps.length) return 'done';
  return t.cursor === 0 ? 'idle' : 'running';
}

/** Can the Run button of this step be pressed? Steps are strictly sequential per transaction. */
export function canRunStep(t: StepperStateView['txns'][TxnLabel], index: number, pageBusy: boolean): boolean {
  const step = t.steps[index];
  return !!step && step.status === 'PENDING' && index === t.cursor && !t.busy && !t.killed && !pageBusy;
}

/**
 * Position in the scenario's suggested order: every step sent and every kill is one action.
 * Returns the index of the next suggested action (== number of actions taken), clamped to order.length.
 */
export function suggestedProgress(order: string[], state: StepperStateView | null): number {
  if (!state) return 0;
  const taken = state.txns.T1.cursor + state.txns.T2.cursor + (state.txns.T1.killed ? 1 : 0) + (state.txns.T2.killed ? 1 : 0);
  return Math.min(taken, order.length);
}

/** 'T1' | 'T2' | 'KILL_T1' | 'KILL_T2' for the next suggested action, or null when the script is exhausted. */
export function nextSuggested(order: string[], state: StepperStateView | null): string | null {
  return order[suggestedProgress(order, state)] ?? null;
}

/** Table preview of a SELECT result: columns of the first row, at most `max` rows. */
export function rowsPreview(rows: unknown, max = 5): { columns: string[]; cells: string[][]; more: number } | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first = rows[0] as Record<string, unknown>;
  if (first == null || typeof first !== 'object') return null;
  const columns = Object.keys(first);
  const show = (v: unknown) => (v === null ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return { columns, cells: rows.slice(0, max).map((r) => columns.map((c) => show((r as Record<string, unknown>)[c]))), more: Math.max(0, rows.length - max) };
}

// ---------------------------------------------------------------- wait-for graph

export interface WaitEdge { from: LockOwner; to: LockOwner; /** Not observed in data_lock_waits: derived from the deadlock error. */ inferred: boolean }

const key = (from: string, to: string) => `${from}>${to}`;

/** Distinct waiter -> blocker edges (self loops dropped). */
export function edgesFromWaits(waits: WaitRow[]): WaitEdge[] {
  const seen = new Set<string>();
  const out: WaitEdge[] = [];
  for (const w of waits) {
    if (w.waitingLabel === w.blockingLabel) continue;
    const k = key(w.waitingLabel, w.blockingLabel);
    if (!seen.has(k)) { seen.add(k); out.push({ from: w.waitingLabel, to: w.blockingLabel, inferred: false }); }
  }
  return out;
}

/** Edges that lie on a cycle: u -> v is on one iff v can reach u. */
export function cycleEdgeKeys(edges: { from: string; to: string }[]): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const reaches = (start: string, goal: string) => {
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === goal) return true;
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
    }
    return false;
  };
  return new Set(edges.filter((e) => reaches(e.to, e.from)).map((e) => key(e.from, e.to)));
}

export interface WaitGraph {
  edges: (WaitEdge & { cycle: boolean })[];
  cycle: boolean;
  /** live: from the current snapshot; last-seen: remembered from before InnoDB resolved it; none: nobody waits. */
  source: 'live' | 'last-seen' | 'none';
  victim: TxnLabel | null;
}

/**
 * Builds the graph to draw. InnoDB breaks a deadlock within microseconds, so the closing edge is almost never
 * observable in performance_schema. When a step failed with errno 1213 the victim waited for the survivor and the
 * survivor was already waiting for the victim: both edges are drawn, the unobserved ones flagged `inferred`.
 */
export function buildWaitGraph(waits: WaitRow[], lastSeen: WaitRow[], victim: TxnLabel | null): WaitGraph {
  const live = edgesFromWaits(waits);
  let edges: WaitEdge[] = live.length ? live : edgesFromWaits(lastSeen);
  let source: WaitGraph['source'] = live.length ? 'live' : edges.length ? 'last-seen' : 'none';
  if (victim) {
    const other: TxnLabel = victim === 'T1' ? 'T2' : 'T1';
    for (const [from, to] of [[victim, other], [other, victim]] as const) {
      if (!edges.some((e) => e.from === from && e.to === to)) edges = [...edges, { from, to, inferred: true }];
    }
    if (source === 'none') source = 'last-seen';
  }
  const cyc = cycleEdgeKeys(edges);
  return { edges: edges.map((e) => ({ ...e, cycle: cyc.has(key(e.from, e.to)) })), cycle: cyc.size > 0, source, victim };
}

export interface GraphNode { id: LockOwner; x: number; y: number; r: number }
export interface GraphEdgeLayout extends WaitEdge { cycle: boolean; path: string; labelX: number; labelY: number }
export interface GraphLayout { width: number; height: number; nodes: GraphNode[]; edges: GraphEdgeLayout[] }

const W = 360;
const H = 150;
const R = 26;
const POS: Record<LockOwner, [number, number]> = { T1: [78, 66], T2: [282, 66], other: [180, 128] };

const unit = (dx: number, dy: number): [number, number] => {
  const d = Math.hypot(dx, dy) || 1;
  return [dx / d, dy / d];
};

/**
 * Fixed layout: T1 left, T2 right, an `other` connection (anything not stepped by this page) below.
 * Each edge is a quadratic curve bowed to the side given by its direction, so a pair of opposite edges
 * (a deadlock) draws as two arcs instead of one overlapping line.
 */
export function layoutWaitGraph(graph: Pick<WaitGraph, 'edges'>): GraphLayout {
  const ids: LockOwner[] = ['T1', 'T2'];
  if (graph.edges.some((e) => e.from === 'other' || e.to === 'other')) ids.push('other');
  const nodes: GraphNode[] = ids.map((id) => ({ id, x: POS[id][0], y: POS[id][1], r: id === 'other' ? 20 : R }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: GraphEdgeLayout[] = graph.edges.map((e) => {
    const a = byId.get(e.from)!;
    const b = byId.get(e.to)!;
    const [ux, uy] = unit(b.x - a.x, b.y - a.y);
    const nx = -uy, ny = ux; // left normal of the direction a -> b: opposite edges bow opposite ways
    const bow = 30;
    const cx = (a.x + b.x) / 2 + nx * bow;
    const cy = (a.y + b.y) / 2 + ny * bow;
    const [sx, sy] = unit(cx - a.x, cy - a.y);
    const [ex, ey] = unit(cx - b.x, cy - b.y);
    const x1 = a.x + sx * a.r, y1 = a.y + sy * a.r;
    const x2 = b.x + ex * (b.r + 4), y2 = b.y + ey * (b.r + 4); // gap for the arrowhead
    return {
      ...e, path: `M ${r1(x1)} ${r1(y1)} Q ${r1(cx)} ${r1(cy)} ${r1(x2)} ${r1(y2)}`,
      labelX: r1(0.25 * x1 + 0.5 * cx + 0.25 * x2), labelY: r1(0.25 * y1 + 0.5 * cy + 0.25 * y2),
    };
  });
  return { width: W, height: H, nodes, edges };
}
const r1 = (n: number) => Math.round(n * 10) / 10;

/** One line under the graph. */
export function graphCaption(g: WaitGraph): string {
  if (g.victim) return `Deadlock resolved: InnoDB rolled back ${g.victim} (errno 1213). Dashed edges are inferred from that error.`;
  if (g.cycle) return 'Wait-for cycle: deadlock';
  if (g.edges.length > 0) return g.edges.map((e) => `${e.from} waits for ${e.to}`).join(' · ');
  return 'No one is waiting';
}
