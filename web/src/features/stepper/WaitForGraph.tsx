import { useMemo } from 'react';
import type { InvariantResult, LockOwner, WaitRow, TxnLabel } from '../../lib/labApi';
import { Pill, ProvenanceTag, Skeleton } from '../../ui';
import { Panel } from '../lab/widgets';
import { buildWaitGraph, graphCaption, layoutWaitGraph } from './logic';

const NODE_STROKE: Record<LockOwner, string> = { T1: 'var(--accent)', T2: 'var(--info)', other: 'var(--faint)' };

/** Wait-for graph: node per transaction, an arrow from the waiter to the blocker. A cycle is a deadlock. */
export function WaitForGraph({ waits, lastSeen, victim }: { waits: WaitRow[]; lastSeen: WaitRow[]; victim: TxnLabel | null }) {
  const graph = useMemo(() => buildWaitGraph(waits, lastSeen, victim), [waits, lastSeen, victim]);
  const layout = useMemo(() => layoutWaitGraph(graph), [graph]);
  const caption = graphCaption(graph);
  const inCycle = new Set(graph.edges.filter((e) => e.cycle).flatMap((e) => [e.from, e.to]));
  return (
    <Panel
      title="Wait-for graph"
      subtitle="Arrow = waits for"
      actions={<><ProvenanceTag kind="MEASURED" />{graph.cycle && <Pill tone="red">cycle</Pill>}</>}
    >
      <div className="flex flex-col items-center gap-2">
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={`Wait-for graph. ${caption}`} className="h-[150px] w-full max-w-[420px]">
          <defs>
            {(['wait', 'cycle'] as const).map((k) => (
              <marker key={k} id={`wf-arrow-${k}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" style={{ fill: k === 'cycle' ? 'var(--bad)' : 'var(--warn)' }} />
              </marker>
            ))}
          </defs>
          {layout.edges.map((e) => (
            <g key={`${e.from}-${e.to}`}>
              <path
                d={e.path}
                fill="none"
                strokeWidth={1.5}
                strokeDasharray={e.inferred ? '4 3' : undefined}
                markerEnd={`url(#wf-arrow-${e.cycle ? 'cycle' : 'wait'})`}
                style={{ stroke: e.cycle ? 'var(--bad)' : 'var(--warn)' }}
              />
              <text x={e.labelX} y={e.labelY - 3} textAnchor="middle" fontSize="9" style={{ fill: 'var(--muted)' }}>{e.inferred ? 'inferred' : 'waits for'}</text>
            </g>
          ))}
          {layout.nodes.map((n) => (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r={n.r} strokeWidth={1.5} style={{ fill: inCycle.has(n.id) ? 'color-mix(in srgb, var(--bad) 14%, var(--surface-2))' : 'var(--surface-2)', stroke: inCycle.has(n.id) ? 'var(--bad)' : NODE_STROKE[n.id] }} />
              <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={n.id === 'other' ? 10 : 13} fontWeight={500} fontFamily="var(--font-mono)" style={{ fill: 'var(--fg)' }}>{n.id}</text>
            </g>
          ))}
        </svg>
        <p className={graph.cycle || graph.victim ? 'text-center text-xs font-medium text-bad' : 'text-center text-xs text-muted'}>{caption}</p>
        <p className="text-center text-xs text-faint">
          InnoDB breaks a deadlock within microseconds, so the closing edge is rarely visible in <span className="font-mono">data_lock_waits</span>. Dashed edges are inferred from errno 1213 and the last wait seen.
        </p>
      </div>
    </Panel>
  );
}

export function InvariantPanel({ invariant, loaded }: { invariant: InvariantResult | null; loaded: boolean }) {
  return (
    <Panel title="Invariant check" subtitle="Active allocations per account must not exceed max streams" actions={<ProvenanceTag kind="MEASURED" />}>
      {!loaded ? (
        <p className="text-sm text-muted">Load a scenario to check the invariant.</p>
      ) : !invariant ? (
        <Skeleton className="h-6 w-40" />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Pill tone={invariant.violations === 0 ? 'green' : 'red'}>{invariant.violations === 0 ? 'holds' : `${invariant.violations} violation${invariant.violations === 1 ? '' : 's'}`}</Pill>
            <span className="text-xs text-muted">re-checked every 500 ms against the scenario&apos;s accounts</span>
          </div>
          {invariant.breaches.map((b) => (
            <p key={b.accountId} className="font-mono text-xs text-bad">account {b.accountId}: {b.active} active, max streams {b.maxStreams}</p>
          ))}
          {invariant.violations === 0 && <p className="text-xs text-faint">Uncommitted changes are invisible to this check, so it moves only after COMMIT.</p>}
        </div>
      )}
    </Panel>
  );
}
