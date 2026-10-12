import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { memo, useEffect, useState } from 'react';
import { useDesignStore } from '../../lib/designStore';
import { Pill } from '../../ui';
import { dotCount, edgeFlow } from './nodes';
import { useStudioUi } from './studioUi';
import { useRunStore } from './runStore';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

const DOT_CYCLE_S = 1.8;

function LinkEdgeImpl({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected }: EdgeProps) {
  const edge = useDesignStore((s) => s.design.edges.find((e) => e.id === id));
  const flow = useRunStore((s) => edgeFlow({ source, target }, s.liveNodes));
  const reduced = useReducedMotion();
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 6 });
  const dots = reduced ? 0 : dotCount(flow);
  const ms = edge?.latencyMs ?? 0;

  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={16} style={{ stroke: selected ? 'var(--accent)' : '#3f3f46', strokeWidth: 1, strokeDasharray: '4 4' }} />
      {dots > 0 && (
        <g aria-hidden pointerEvents="none">
          {Array.from({ length: dots }, (_, i) => (
            <circle key={i} r={2.5} fill="var(--accent)">
              <animateMotion dur={`${DOT_CYCLE_S}s`} begin={`${-(i * DOT_CYCLE_S) / dots}s`} repeatCount="indefinite" path={path} />
            </circle>
          ))}
        </g>
      )}
      <EdgeLabelRenderer>
        <button
          type="button"
          aria-label={`Link latency ${ms} ms`}
          onClick={() => useStudioUi.getState().selectEdge(id)}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="nodrag nopan pointer-events-auto absolute"
        >
          <span className="block rounded-full bg-bg"><Pill mono tone={selected ? 'accent' : 'neutral'}>{`${Number(ms.toFixed(1))} ms`}</Pill></span>
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

export const LinkEdge = memo(LinkEdgeImpl);
