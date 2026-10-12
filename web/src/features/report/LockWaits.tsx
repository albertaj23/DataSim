import { useMemo } from 'react';
import type { LockWaitRow } from '@datasim/shared';
import { formatNumber } from '../../lib/format';
import { TBody, TD, TH, THead, TR, Table } from '../../ui';
import { aggregateLockWaits, layoutNodes, waitGraph, type GraphEdge, type GraphNode } from './logic';
import { Panel, Section } from './Section';

const W = 560;
const H_FULL = 240;
const H_SMALL = 150;
const BW = 112; // node box
const BH = 30;

/** Point where the ray from `a` towards `b` leaves a's box (plus a small gap for the arrow head). */
function exit(a: GraphNode, b: { x: number; y: number }, gap = 3): { x: number; y: number } {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.min(dx !== 0 ? BW / 2 / Math.abs(dx) : Infinity, dy !== 0 ? BH / 2 / Math.abs(dy) : Infinity);
  return { x: a.x + dx * t + (dx / len) * gap, y: a.y + dy * t + (dy / len) * gap };
}

function Edge({ e, a, b, offset }: { e: GraphEdge; a: GraphNode; b: GraphNode; offset: number }) {
  const label = `${e.table} · ${e.mode.replace(',REC_NOT_GAP', ' rec')} ×${formatNumber(e.count)}`;
  const tw = label.length * 5.6 + 12;
  if (a.id === b.id) {
    const x = a.x; const y = a.y - BH / 2;
    return (
      <g>
        <path d={`M ${x + 22} ${y} C ${x + 30} ${y - 46}, ${x - 30} ${y - 46}, ${x - 22} ${y - 2}`} fill="none" stroke="var(--warn)" strokeWidth={1.25} markerEnd="url(#wf-arrow)" />
        <rect x={x - tw / 2} y={y - 50} width={tw} height={16} rx={8} fill="var(--surface-2)" stroke="var(--line)" />
        <text x={x} y={y - 38.5} textAnchor="middle" className="fill-[var(--muted)] font-mono text-[10px]">{label}</text>
      </g>
    );
  }
  // curve: control point pushed along the canonical normal of the (unordered) pair so opposite edges never overlap
  const [p, q] = a.id < b.id ? [a, b] : [b, a];
  const nx = -(q.y - p.y); const ny = q.x - p.x; const nl = Math.hypot(nx, ny) || 1;
  const mx = (a.x + b.x) / 2 + (nx / nl) * offset; const my = (a.y + b.y) / 2 + (ny / nl) * offset;
  const s = exit(a, { x: mx, y: my }); const t = exit(b, { x: mx, y: my }, 4);
  const lx = 0.25 * s.x + 0.5 * mx + 0.25 * t.x; const ly = 0.25 * s.y + 0.5 * my + 0.25 * t.y;
  return (
    <g>
      <path d={`M ${s.x} ${s.y} Q ${mx} ${my} ${t.x} ${t.y}`} fill="none" stroke="var(--warn)" strokeWidth={1.25} markerEnd="url(#wf-arrow)" />
      <rect x={lx - tw / 2} y={ly - 8} width={tw} height={16} rx={8} fill="var(--surface-2)" stroke="var(--line)" />
      <text x={lx} y={ly + 3.5} textAnchor="middle" className="fill-[var(--muted)] font-mono text-[10px]">{label}</text>
    </g>
  );
}

/** Wait-for graph from the sampled data_lock_waits snapshots: an arrow goes from the waiting transaction to the one holding the lock. */
export function WaitGraph({ rows }: { rows: LockWaitRow[] }) {
  const { edges, nodes, offsets, H } = useMemo(() => {
    const g = waitGraph(rows);
    const H = g.nodeIds.length <= 2 ? H_SMALL : H_FULL;
    const nodes = layoutNodes(g.nodeIds, W, H);
    // spread edges that share the same unordered pair
    const seen = new Map<string, number>(); const total = new Map<string, number>();
    const pairKey = (e: GraphEdge) => [e.from, e.to].sort().join('\u0000');
    for (const e of g.edges) total.set(pairKey(e), (total.get(pairKey(e)) ?? 0) + 1);
    const offsets = g.edges.map((e) => {
      const k = pairKey(e); const i = seen.get(k) ?? 0; seen.set(k, i + 1);
      const n = total.get(k)!;
      return n === 1 ? 0 : (i - (n - 1) / 2) * 44;
    });
    return { edges: g.edges, nodes, offsets, H };
  }, [rows]);
  const pos = new Map(nodes.map((n) => [n.id, n]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Wait-for graph with ${nodes.length} transactions and ${edges.length} wait relationships`} data-testid="wait-graph">
      <defs>
        <marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="var(--warn)" /></marker>
      </defs>
      {edges.map((e, i) => <Edge key={`${e.from}|${e.to}|${e.table}|${e.mode}`} e={e} a={pos.get(e.from)!} b={pos.get(e.to)!} offset={offsets[i]!} />)}
      {nodes.map((n) => (
        <g key={n.id}>
          <rect x={n.x - BW / 2} y={n.y - BH / 2} width={BW} height={BH} rx={8} fill="var(--surface-2)" stroke="var(--line-strong)" />
          <text x={n.x} y={n.y + 4} textAnchor="middle" className="fill-[var(--fg)] font-mono text-[11px]">{n.id.length > 14 ? `${n.id.slice(0, 13)}…` : n.id}</text>
        </g>
      ))}
    </svg>
  );
}

export function LockWaits({ rows }: { rows: LockWaitRow[] }) {
  const agg = useMemo(() => aggregateLockWaits(rows), [rows]);
  return (
    <Section id="locks" title="Lock waits" provenance="MEASURED" aside={rows.length ? `${formatNumber(rows.length)} sampled waits · performance_schema.data_lock_waits` : undefined}>
      {rows.length === 0 ? (
        <Panel className="px-4 py-8 text-center text-xs text-muted">No lock waits were observed during the measured window. Contention-free access paths keep this empty.</Panel>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <Panel className="p-3">
            <div className="mb-1 text-xs text-muted">Wait-for graph · arrow = waits for</div>
            <WaitGraph rows={rows} />
          </Panel>
          <div className="max-h-[300px] overflow-auto rounded-lg">
            <Table>
              <THead><TR><TH>Waiting</TH><TH>Blocked by</TH><TH>Resource</TH><TH>Mode</TH><TH>Key</TH><TH align="right">Samples</TH></TR></THead>
              <TBody>
                {agg.slice(0, 40).map((l, i) => (
                  <TR key={i}>
                    <TD mono className="max-w-[110px] truncate" title={l.waiting}>{l.waiting}</TD>
                    <TD mono className="max-w-[110px] truncate" title={l.blocking}>{l.blocking}</TD>
                    <TD mono className="text-muted">{l.table}{l.index ? `.${l.index}` : ''}</TD>
                    <TD mono className="text-muted">{l.mode}</TD>
                    <TD mono className="max-w-[90px] truncate text-muted" title={l.key ?? ''}>{l.key ?? '-'}</TD>
                    <TD align="right" mono>{formatNumber(l.count)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </div>
      )}
    </Section>
  );
}
