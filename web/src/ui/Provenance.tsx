import type { Provenance } from '@datasim/shared';
import { Info } from 'lucide-react';
import { cn } from './cn';
import { Pill, type Tone } from './Pill';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { Tooltip } from './Tooltip';

export const PROVENANCE_TEXT: Record<Provenance, string> = {
  MEASURED: 'Observed from MySQL or the real request path: DB execution time, lock waits, deadlocks, rows examined, invariants, end-to-end latency, cache hit ratio.',
  EMULATED: 'An injected delay or modeled component that really ran in the request path: link latency, app processing time, load balancer. Implemented as real awaits, so it holds VUs and creates real queueing.',
  PROJECTED: 'A math model fitted to measured data (Universal Scalability Law). Anything beyond the largest tested load is a projection, not an observation.',
};
const TONE: Record<Provenance, Tone> = { MEASURED: 'green', EMULATED: 'amber', PROJECTED: 'blue' };

/** Small uppercase tag with an explanatory tooltip. Put it next to any number's label. */
export function ProvenanceTag({ kind, className }: { kind: Provenance; className?: string }) {
  return (
    <Tooltip content={PROVENANCE_TEXT[kind]}>
      <span tabIndex={0} className={cn('inline-flex rounded-full', className)}>
        <Pill tone={TONE[kind]} className={cn('h-4 px-1.5 text-[10px] font-medium uppercase tracking-wide', kind === 'PROJECTED' && 'border-dashed')}>{kind}</Pill>
      </span>
    </Tooltip>
  );
}

/** Body of the "How measurements work" explanation (brief 4.1). */
export function HowMeasurementsWork({ className }: { className?: string }) {
  const rows: { kind: Provenance; items: string }[] = [
    { kind: 'MEASURED', items: 'DB execution time, lock waits, deadlocks, rows examined, invariants, end-to-end wall-clock latency (including emulated delays and real queueing) and cache hit ratio.' },
    { kind: 'EMULATED', items: 'Link latency, app processing time and the load balancer. They are real awaits in the request path, so they really hold virtual users and really create queueing.' },
    { kind: 'PROJECTED', items: 'Capacity beyond the tested load: a Universal Scalability Law fit to measured points, dashed on charts.' },
  ];
  return (
    <div className={cn('flex flex-col gap-3 text-sm', className)}>
      <p className="text-muted">
        A run provisions a real sandbox database, seeds it, then sends closed-loop virtual users through your topology to real MySQL 8.4 transactions. Each request is timed in phases: queue, link, app, pool wait, DB execution.
      </p>
      <ul className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <li key={r.kind} className="flex flex-col gap-1">
            <ProvenanceTag kind={r.kind} className="self-start" />
            <span className="text-xs text-muted">{r.items}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-faint">The cache is a real Redis (cache-aside); if Redis is unreachable at run start the run is blocked rather than emulated.</p>
    </div>
  );
}

/** Info icon button that opens <HowMeasurementsWork /> in a popover. */
export function HowMeasurementsWorkPopover({ className }: { className?: string }) {
  return (
    <Popover>
      <Tooltip content="How measurements work">
        <PopoverTrigger asChild>
          <button type="button" aria-label="How measurements work" className={cn('inline-flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-fg', className)}>
            <Info size={14} />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent width={340}>
        <div className="mb-2 text-sm font-medium">How measurements work</div>
        <HowMeasurementsWork />
      </PopoverContent>
    </Popover>
  );
}
