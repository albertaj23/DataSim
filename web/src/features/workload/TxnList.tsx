import { Plus, Scale } from 'lucide-react';
import type { Transaction } from '@datasim/shared';
import { Button, Pill, Tooltip, cn } from '../../ui';
import { formatPct, mixPercents } from './logic';

/** Segment colors for the mix bar: restrained, distinguishable, token-driven where possible. */
const SEGMENTS = ['var(--accent)', 'var(--info)', 'var(--warn)', '#a78bfa', 'var(--ok)', '#f472b6', '#94a3b8', '#fb923c'];
export const segmentColor = (i: number) => SEGMENTS[i % SEGMENTS.length]!;

export function MixBar({ txns }: { txns: Transaction[] }) {
  const pct = mixPercents(txns);
  const total = txns.reduce((n, t) => n + t.weight, 0);
  return (
    <div>
      <div className="flex h-2 gap-px overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`Transaction mix: ${txns.map((t, i) => `${t.name} ${formatPct(pct[i]!)}`).join(', ')}`}>
        {txns.map((t, i) => pct[i]! > 0 && (
          <Tooltip key={t.name} content={`${t.name} ${formatPct(pct[i]!)}`}>
            <div style={{ width: `${pct[i]}%`, background: segmentColor(i) }} className="h-full min-w-[2px]" />
          </Tooltip>
        ))}
      </div>
      {total === 0 && txns.length > 0 && <div className="mt-1.5 text-xs text-bad">All weights are 0: nothing would run.</div>}
    </div>
  );
}

export function TxnList({ txns, selected, onSelect, onAdd, onNormalize }: { txns: Transaction[]; selected: string | null; onSelect: (name: string) => void; onAdd: () => void; onNormalize: () => void }) {
  const pct = mixPercents(txns);
  const sum = txns.reduce((n, t) => n + t.weight, 0);
  const normalized = sum === 100;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3 border-b border-line px-3 py-3">
        <div className="flex h-6 items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Transaction mix</h3>
          <Tooltip content={normalized ? 'Weights already sum to 100' : 'Rescale weights to whole percents summing to 100'}>
            <span><Button size="sm" variant="ghost" icon={<Scale size={14} />} disabled={normalized || sum === 0} onClick={onNormalize}>Normalize</Button></span>
          </Tooltip>
        </div>
        <MixBar txns={txns} />
      </div>
      <div className="flex-1 overflow-auto py-1">
        {txns.length === 0 && <p className="px-3 py-4 text-xs text-muted">No transactions yet. Virtual users pick one by weight, run its steps in a real transaction and report latency per transaction.</p>}
        {txns.map((t, i) => {
          const variants = Object.keys(t.variants).length;
          const active = t.name === selected;
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => onSelect(t.name)}
              aria-current={active || undefined}
              className={cn('relative flex w-full flex-col gap-1.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-2', active && 'bg-surface-2')}
            >
              {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: segmentColor(i) }} />
                <span className="min-w-0 flex-1 truncate font-mono text-sm" title={t.name}>{t.name}</span>
                <span className="font-mono text-xs text-muted tnum">{formatPct(pct[i]!)}</span>
              </div>
              <div className="flex items-center gap-1.5 pl-4">
                <Pill tone={t.readOnly ? 'green' : 'amber'}>{t.readOnly ? 'read' : 'write'}</Pill>
                {t.cacheable && <Pill tone="blue">cacheable</Pill>}
                <Pill mono>{variants} {variants === 1 ? 'variant' : 'variants'}</Pill>
              </div>
            </button>
          );
        })}
      </div>
      <div className="border-t border-line p-3">
        <Button className="w-full" icon={<Plus size={14} />} onClick={onAdd}>Add transaction</Button>
      </div>
    </div>
  );
}
