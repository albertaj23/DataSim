// Pure helpers behind the run report: KPI strip, capacity curve, lock-wait graph, EXPLAIN summary, re-run overrides.
// No React here so everything is unit-testable (logic.test.ts).
import { uslThroughput, type CapacityFit, type CapacityPoint, type FindingFix, type LockWaitRow, type Provenance, type RunOverrides, type RunReport, type RunSample } from '@datasim/shared';
import { formatMs, formatNumber, formatPct } from '../../lib/format';
import type { Tone } from '../../ui';

// ---------------------------------------------------------------- KPI strip
export interface Kpi { key: string; label: string; value: string; sub?: string; tone: Tone; provenance: Provenance }

const pctOf = (part: number, total: number) => (total > 0 ? formatPct(part / total, 1) : '-');

export function buildKpis(r: RunReport): Kpi[] {
  const run = r.run;
  const slo = r.design.slo;
  const invTotal = r.invariants.length;
  const invFailing = r.invariants.filter((i) => !i.passed).length;
  const p95Breach = run.p95Ms > slo.p95Ms;
  return [
    { key: 'tps', label: 'Throughput', value: `${formatNumber(run.tpsAvg)}`, sub: 'tps · committed + rejected', tone: 'neutral', provenance: 'MEASURED' },
    { key: 'p50', label: 'p50', value: formatMs(run.p50Ms), sub: 'median latency', tone: 'neutral', provenance: 'MEASURED' },
    { key: 'p95', label: 'p95', value: formatMs(run.p95Ms), sub: `SLO ≤ ${formatMs(slo.p95Ms)}`, tone: p95Breach ? 'red' : 'green', provenance: 'MEASURED' },
    { key: 'p99', label: 'p99', value: formatMs(run.p99Ms), sub: 'tail latency', tone: 'neutral', provenance: 'MEASURED' },
    { key: 'committed', label: 'Committed', value: formatNumber(run.committed), sub: `${pctOf(run.committed, run.txnTotal)} of ${formatNumber(run.txnTotal)}`, tone: 'neutral', provenance: 'MEASURED' },
    { key: 'rejected', label: 'Rejected', value: formatNumber(run.rejected), sub: `${pctOf(run.rejected, run.txnTotal)} business rejects`, tone: 'neutral', provenance: 'MEASURED' },
    { key: 'errors', label: 'Errors', value: formatNumber(run.errored), sub: `${pctOf(run.errored, run.txnTotal)} · SLO ≤ ${slo.maxErrorPct}%`, tone: run.errored > 0 ? 'red' : 'neutral', provenance: 'MEASURED' },
    { key: 'deadlocks', label: 'Deadlocks', value: formatNumber(run.deadlocks), sub: `${formatNumber(run.retries)} retries · ${formatNumber(run.lockTimeouts)} lock timeouts`, tone: run.deadlocks > 0 ? 'amber' : 'neutral', provenance: 'MEASURED' },
    {
      key: 'violations', label: 'Invariant violations', value: formatNumber(run.invariantViolations),
      sub: invTotal === 0 ? 'no invariants defined' : `${invFailing} of ${invTotal} invariants failing`,
      tone: run.invariantViolations > 0 ? 'red' : invTotal > 0 ? 'green' : 'neutral', provenance: 'MEASURED',
    },
    { key: 'cache', label: 'Cache hit', value: r.cacheHitRatio == null ? '-' : formatPct(r.cacheHitRatio, 1), sub: r.cacheHitRatio == null ? 'no cache in this design' : 'Redis cache-aside', tone: 'neutral', provenance: 'MEASURED' },
  ];
}

/** One-line description of the run configuration for the header, e.g. "naive · REPEATABLE READ · 200 VUs · 20 s". */
export function runConfigLine(r: RunReport): string {
  const run = r.run;
  return [run.strategy, run.isolation, `${run.vus} VUs`, `${run.durationS} s`].join(' · ');
}

// ---------------------------------------------------------------- capacity curve
export interface CurveRow { n: number; /** measured */ tps?: number; p95?: number; /** fitted, inside the tested range */ fit?: number; /** fitted, beyond the largest tested N (PROJECTED) */ proj?: number }

/**
 * Rows for the TPS-vs-VUs chart: measured points, the fitted USL curve solid up to the largest tested N and dashed (PROJECTED) beyond it.
 * The projection runs to 1.5x the largest tested N, extended to just past the predicted peak N* when that is within 4x.
 */
export function capacityCurve(points: CapacityPoint[], fit: CapacityFit | null, samples = 60): { rows: CurveRow[]; maxTested: number; end: number } {
  const pts = [...points].sort((a, b) => a.vus - b.vus);
  const maxTested = pts.length ? pts[pts.length - 1]!.vus : 0;
  const byN = new Map<number, CurveRow>();
  for (const p of pts) byN.set(p.vus, { n: p.vus, tps: p.tps, p95: p.p95Ms });
  let end = maxTested;
  if (fit && maxTested > 0) {
    end = maxTested * 1.5;
    if (fit.nPeak !== null && fit.nPeak > maxTested && fit.nPeak <= maxTested * 4) end = Math.max(end, fit.nPeak * 1.25);
    end = Math.ceil(end);
    const grid = new Set<number>([1, ...pts.map((p) => p.vus), maxTested]);
    for (let i = 0; i <= samples; i++) grid.add(Math.max(1, Math.round(1 + ((end - 1) * i) / samples)));
    for (const n of grid) {
      const row = byN.get(n) ?? { n };
      const y = uslThroughput(n, fit);
      if (n <= maxTested) row.fit = y;
      if (n >= maxTested) row.proj = y; // the boundary point belongs to both so the two segments touch
      byN.set(n, row);
    }
  }
  return { rows: [...byN.values()].sort((a, b) => a.n - b.n), maxTested, end };
}

/** Peak N* is only drawn when the fit has a retrograde region that is not absurdly far away. */
export const hasFinitePeak = (fit: CapacityFit | null, maxTested: number): fit is CapacityFit & { nPeak: number } => !!fit && fit.nPeak !== null && fit.nPeak < 1e5 && fit.nPeak > 0 && fit.nPeak <= Math.max(maxTested * 6, 10);

export interface LittleCheck { vus: number; predicted: number; ratio: number }
export function littlesLaw(settings: Record<string, unknown>): LittleCheck[] {
  const raw = settings.littlesLaw;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is LittleCheck => !!x && typeof x === 'object' && typeof (x as LittleCheck).vus === 'number' && typeof (x as LittleCheck).predicted === 'number');
}
/** "N ≈ X·(R+Z): predicted 49.6 vs 50 configured VUs (ratio 0.99)" for one step; green when within 15%. */
export function littleLine(c: LittleCheck): { text: string; ok: boolean } {
  return { text: `${c.vus} VUs: X·(R+Z) = ${c.predicted.toFixed(1)} (ratio ${c.ratio.toFixed(2)})`, ok: Math.abs(c.ratio - 1) <= 0.15 };
}

// ---------------------------------------------------------------- lock waits + wait-for graph
export interface LockAgg { waiting: string; blocking: string; table: string; index: string | null; mode: string; key: string | null; count: number }

/** The sampler records one row per observed wait per snapshot; collapse identical ones into a count. */
export function aggregateLockWaits(rows: LockWaitRow[]): LockAgg[] {
  const m = new Map<string, LockAgg>();
  for (const l of rows) {
    const k = [l.waitingTxn, l.blockingTxn, l.tableName, l.indexName, l.lockMode, l.lockData].join('\u0000');
    const e = m.get(k);
    if (e) e.count++;
    else m.set(k, { waiting: l.waitingTxn, blocking: l.blockingTxn, table: l.tableName, index: l.indexName, mode: l.lockMode, key: l.lockData, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

export interface GraphEdge { from: string; to: string; table: string; mode: string; count: number }
export interface GraphNode { id: string; x: number; y: number }

/** Edges point from the waiting transaction to the one it waits for; grouped by (waiting, blocking, table, mode). */
export function waitGraph(rows: LockWaitRow[]): { edges: GraphEdge[]; nodeIds: string[] } {
  const m = new Map<string, GraphEdge>();
  for (const l of rows) {
    const k = [l.waitingTxn, l.blockingTxn, l.tableName, l.lockMode].join('\u0000');
    const e = m.get(k);
    if (e) e.count++;
    else m.set(k, { from: l.waitingTxn, to: l.blockingTxn, table: l.tableName, mode: l.lockMode, count: 1 });
  }
  const edges = [...m.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  const ids: string[] = [];
  for (const e of edges) for (const id of [e.from, e.to]) if (!ids.includes(id)) ids.push(id);
  return { edges, nodeIds: ids };
}

/** Nodes on an ellipse inside w x h (centered when alone, left/right for two). */
export function layoutNodes(ids: string[], w: number, h: number, pad = 56): GraphNode[] {
  const n = ids.length;
  if (n === 0) return [];
  if (n === 1) return [{ id: ids[0]!, x: w / 2, y: h / 2 }];
  if (n === 2) return [{ id: ids[0]!, x: pad + 24, y: h / 2 }, { id: ids[1]!, x: w - pad - 24, y: h / 2 }];
  const rx = w / 2 - pad - 16; const ry = h / 2 - pad / 2 - 8;
  return ids.map((id, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { id, x: w / 2 + rx * Math.cos(a), y: h / 2 + ry * Math.sin(a) };
  });
}

// ---------------------------------------------------------------- EXPLAIN
export interface ExplainTable { table: string; access: string | null; key: string | null; rows: number | null; filtered: string | null; cost: string | null; condition: string | null }

/** Walks an EXPLAIN FORMAT=JSON document and lists every table access in plan order. */
export function explainTables(explain: unknown): ExplainTable[] {
  const out: ExplainTable[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.table_name === 'string') {
      const cost = o.cost_info as Record<string, unknown> | undefined;
      out.push({
        table: o.table_name, access: typeof o.access_type === 'string' ? o.access_type : null, key: typeof o.key === 'string' ? o.key : null,
        rows: typeof o.rows_examined_per_scan === 'number' ? o.rows_examined_per_scan : null, filtered: typeof o.filtered === 'string' ? o.filtered : null,
        cost: cost && typeof cost.prefix_cost === 'string' ? cost.prefix_cost : null, condition: typeof o.attached_condition === 'string' ? o.attached_condition : null,
      });
    }
    for (const k of Object.keys(o)) if (k !== 'table_name') walk(o[k]);
  };
  walk(explain);
  return out;
}

export const isFullScan = (t: ExplainTable) => t.access === 'ALL';

// ---------------------------------------------------------------- findings
const RATIO_KEY = /share|ratio|hit|fraction|pct|percent|utili[sz]ation|errorRate/i;
const R2_KEY = /^(r2|rSquared)$/i;

/** One evidence number: R^2 at 2 decimals, shares / ratios / hit rates in 0..1 as percentages (0.995 -> 99.5%), else up to 3 decimals. */
export function evidenceNumber(key: string, v: number): string {
  if (R2_KEY.test(key)) return v.toFixed(2);
  if (!Number.isInteger(v) && RATIO_KEY.test(key) && v >= 0 && v <= 1) return `${Number((v * 100).toFixed(1))}%`;
  return Number.isInteger(v) ? formatNumber(v) : String(Number(v.toFixed(3)));
}

/** Evidence entries worth showing as chips: short primitives and short flat lists; drops SQL text and nested objects. */
export function evidenceChips(evidence: Record<string, unknown>): { label: string; value: string }[] {
  const skip = new Set(['statement', 'digest', 'digestText', 'points', 'fit', 'littlesLaw']);
  const out: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries(evidence)) {
    if (skip.has(k) || v == null) continue;
    let s: string | null = null;
    if (typeof v === 'number') s = evidenceNumber(k, v);
    else if (typeof v === 'string') s = v;
    else if (typeof v === 'boolean') s = v ? 'yes' : 'no';
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) s = v.join(', ');
    else if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'number')) s = Object.entries(v).map(([a, b]) => `${a} ${formatNumber(b as number)}`).join(', ');
    if (s == null || s.length > 90 || s === '') continue;
    out.push({ label: k.replace(/([A-Z])/g, ' $1').toLowerCase(), value: s });
  }
  return out;
}

// ---------------------------------------------------------------- re-run
/** Overrides stored on the run, with the strategy replaced when the applied fix is SET_STRATEGY. */
export function rerunOverrides(settings: Record<string, unknown>, fix?: FindingFix | null): RunOverrides {
  const stored = settings.overrides && typeof settings.overrides === 'object' ? { ...(settings.overrides as RunOverrides) } : {};
  if (fix?.type === 'SET_STRATEGY') stored.strategy = fix.strategy;
  return stored;
}

export const rerunKind = (r: RunReport): 'LOAD' | 'CAPACITY' => (r.run.kind === 'CAPACITY' ? 'CAPACITY' : 'LOAD');

/** Live samples carry tS <= 0 during warm-up; persisted samples never do. */
export const measuredSamples = (s: RunSample[]) => s.filter((x) => x.tS >= 1);

/** Share of a mean-latency total that each phase accounts for, for the per-transaction table. */
export function phaseShare(parts: { queueMs: number; netMs: number; appMs: number; poolMs: number; dbMs: number }): { total: number; dominant: string } {
  const entries: [string, number][] = [['queue', parts.queueMs], ['network', parts.netMs], ['app', parts.appMs], ['pool wait', parts.poolMs], ['database', parts.dbMs]];
  const total = entries.reduce((s, [, v]) => s + Math.max(0, v), 0);
  const top = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { total, dominant: total > 0 ? top[0] : '-' };
}

export const exportUrl = (runId: string, what: 'md' | 'samples' | 'txn') =>
  what === 'md' ? `/api/runs/${runId}/export.md` : what === 'txn' ? `/api/runs/${runId}/export.csv?part=txn` : `/api/runs/${runId}/export.csv`;
