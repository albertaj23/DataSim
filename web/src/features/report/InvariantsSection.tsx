import { ChevronRight, CircleCheck, CircleX } from 'lucide-react';
import { useState } from 'react';
import type { InvariantResult } from '@datasim/shared';
import { formatNumber } from '../../lib/format';
import { CodeBlock, Pill, cn } from '../../ui';
import { Panel, Section } from './Section';

function InvariantRow({ inv }: { inv: InvariantResult }) {
  const [open, setOpen] = useState(false);
  const failed = !inv.passed;
  return (
    <li data-testid={`invariant-${inv.name}`}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <button type="button" aria-expanded={open} aria-label={open ? 'Hide SQL' : 'Show SQL'} onClick={() => setOpen((o) => !o)} className="mt-0.5 rounded text-faint transition-colors hover:text-fg">
          <ChevronRight size={14} className={cn('transition-transform duration-150', open && 'rotate-90')} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-fg">{inv.name}</span>
            <Pill tone={failed ? 'red' : 'green'} icon={failed ? <CircleX size={11} /> : <CircleCheck size={11} />}>{inv.error ? 'ERROR' : failed ? 'FAIL' : 'PASS'}</Pill>
          </div>
          {inv.description && <p className="mt-0.5 text-xs text-muted">{inv.description}</p>}
          {inv.error && <p className="mt-1 font-mono text-xs text-bad">{inv.error}</p>}
        </div>
        <div className="shrink-0 text-right">
          <div className={cn('font-mono text-base tnum', failed ? 'text-bad' : 'text-fg')}>{formatNumber(inv.violations)}</div>
          <div className="text-[11px] text-faint">violations</div>
        </div>
      </div>
      {open && <div className="px-3 pb-3 pl-[38px]"><CodeBlock code={inv.sql} maxHeight={220} /></div>}
    </li>
  );
}

/** SQL invariants evaluated against the sandbox after the run. 0 violations = pass. */
export function InvariantsSection({ invariants }: { invariants: InvariantResult[] }) {
  const failing = invariants.filter((i) => !i.passed).length;
  return (
    <Section id="invariants" title="Invariants" provenance="MEASURED" aside={invariants.length ? (failing ? `${failing} of ${invariants.length} failing` : `all ${invariants.length} passing`) : undefined}>
      {invariants.length === 0 ? (
        <Panel className="px-4 py-8 text-center text-xs text-muted">This design defines no invariants. Add SQL checks in the Workload Editor to verify data correctness after each run.</Panel>
      ) : (
        <Panel><ul className="divide-y divide-line">{invariants.map((i) => <InvariantRow key={i.name} inv={i} />)}</ul></Panel>
      )}
    </Section>
  );
}
