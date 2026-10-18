import { ArrowRight, Minus, Pencil, Plus } from 'lucide-react';
import type { RunReport } from '@datasim/shared';
import { cn } from '../../ui';
import { Panel, Section } from '../report/Section';
import { diffRuns, runLetter, type DiffArea, type DiffEntry } from './diff';

const AREAS: DiffArea[] = ['Run settings', 'Topology', 'Schema', 'Workload', 'SLO'];
const ICON = { added: { Icon: Plus, cls: 'text-ok' }, removed: { Icon: Minus, cls: 'text-bad' }, changed: { Icon: Pencil, cls: 'text-warn' } } as const;

function Entry({ e }: { e: DiffEntry }) {
  const { Icon, cls } = ICON[e.kind];
  return (
    <li className="flex items-start gap-2 py-1 text-xs" data-kind={e.kind}>
      <Icon size={12} className={cn('mt-[3px] shrink-0', cls)} aria-label={e.kind} />
      <span className="shrink-0 font-mono text-fg">{e.label}</span>
      {e.kind === 'changed' ? (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-muted"><span className="truncate line-through decoration-faint/60">{e.before}</span><ArrowRight size={11} className="shrink-0 text-faint" /><span className="truncate text-fg">{e.after}</span></span>
      ) : (
        <span className="min-w-0 truncate font-mono text-muted">{e.kind === 'added' ? e.after : e.before}</span>
      )}
    </li>
  );
}

/** What changed between run A and each other run: effective run settings, then the design when the revisions differ. */
export function DesignDiff({ runs, labels }: { runs: RunReport[]; labels: string[] }) {
  const base = runs[0]!;
  return (
    <Section id="design" title="What changed" aside="design and settings versus run A">
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2" data-testid="design-diff">
        {runs.slice(1).map((r, k) => {
          const i = k + 1;
          const entries = diffRuns(base, r);
          const sameRev = r.run.revisionNo === base.run.revisionNo;
          return (
            <Panel key={r.run.runId} className="px-4 py-3">
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-fg">
                <span className="font-mono text-faint">{runLetter(i)}</span>{labels[i]}<span className="font-normal text-faint">vs</span><span className="font-mono text-faint">A</span><span className="font-normal text-muted">{labels[0]}</span>
              </h3>
              {entries.length === 0 ? (
                <p className="py-2 text-xs text-muted">{sameRev ? 'Same revision and same settings.' : 'Different revisions, but the designs are identical.'}</p>
              ) : (
                AREAS.map((area) => {
                  const list = entries.filter((e) => e.area === area);
                  if (!list.length) return null;
                  return (
                    <div key={area} className="mt-2 first:mt-0">
                      <div className="mb-0.5 text-[11px] uppercase tracking-wide text-faint">{area}</div>
                      <ul className="divide-y divide-line/60">{list.map((e, j) => <Entry key={j} e={e} />)}</ul>
                    </div>
                  );
                })
              )}
              {sameRev && entries.length > 0 && <p className="mt-2 border-t border-line pt-2 text-[11px] text-faint">Both runs used revision {r.run.revisionNo}; only run settings differ.</p>}
            </Panel>
          );
        })}
      </div>
    </Section>
  );
}
