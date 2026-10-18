// Collapsible "Which database fits?" section for the Database node inspector.
import { ChevronRight } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useDesignStore } from '../../lib/designStore';
import { Pill, cn, type Tone } from '../../ui';
import { dbFit, FIT_DISCLAIMER, type FitLevel } from './dbFit';

const LEVEL: Record<FitLevel, { label: string; tone: Tone }> = {
  strong: { label: 'strong fit', tone: 'green' },
  good: { label: 'fits', tone: 'green' },
  consider: { label: 'consider', tone: 'blue' },
  caution: { label: 'watch out', tone: 'amber' },
};
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function DbFitCard() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const nodes = useDesignStore((s) => s.design.nodes);
  const schema = useDesignStore((s) => s.design.schema);
  const workload = useDesignStore((s) => s.design.workload);
  const fit = useMemo(() => (open ? dbFit({ nodes, schema, workload }) : null), [open, nodes, schema, workload]);

  return (
    <section className="border-b border-line px-3 py-1 last:border-b-0" data-testid="db-fit">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex h-8 w-full items-center justify-between text-left">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Which database fits?</h3>
        <ChevronRight size={14} className={cn('text-faint transition-transform duration-150 ease-out', open && 'rotate-90')} />
      </button>
      {open && fit && (
        <div id={id} className="pb-2">
          <dl className="mb-2.5 grid grid-cols-4 gap-1.5">
            {([['reads', pct(fit.metrics.readShare)], ['writes', pct(fit.metrics.writeShare)], ['cacheable', pct(fit.metrics.cacheableShare)], ['VUs', String(fit.metrics.vus)]] as const).map(([k, v]) => (
              <div key={k} className="rounded-md border border-line bg-surface px-1.5 py-1">
                <dt className="text-[10px] text-faint">{k}</dt>
                <dd className="font-mono text-xs text-fg tnum">{v}</dd>
              </div>
            ))}
          </dl>
          <ul className="flex flex-col gap-2">
            {fit.recommendations.map((r) => (
              <li key={r.id} className="rounded-md border border-line bg-surface p-2">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <span className="text-sm font-medium leading-snug text-fg">{r.title}</span>
                  <Pill tone={LEVEL[r.level].tone} className="mt-0.5">{LEVEL[r.level].label}</Pill>
                </div>
                <p className="text-xs leading-relaxed text-muted">{r.reasoning}</p>
                {r.evidence.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-0.5 border-t border-line pt-1.5">
                    {r.evidence.map((e) => <li key={e} className="text-[11px] leading-snug text-faint">{e}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-faint">{FIT_DISCLAIMER}</p>
        </div>
      )}
    </section>
  );
}
