import type { Provenance, TxnStat } from '@datasim/shared';
import { Tooltip, cn } from '../../ui';

type Parts = Pick<TxnStat, 'queueMs' | 'netMs' | 'appMs' | 'poolMs' | 'dbMs'>;

/** "Where the time went": the five request phases, in the order a request meets them. */
export const TIME_PARTS: { key: keyof Parts; label: string; color: string; provenance: Provenance }[] = [
  { key: 'queueMs', label: 'queue', color: '#a78bfa', provenance: 'MEASURED' },
  { key: 'netMs', label: 'network', color: 'var(--info)', provenance: 'EMULATED' },
  { key: 'appMs', label: 'app', color: 'var(--accent)', provenance: 'EMULATED' },
  { key: 'poolMs', label: 'pool wait', color: 'var(--warn)', provenance: 'MEASURED' },
  { key: 'dbMs', label: 'database', color: 'var(--ok)', provenance: 'MEASURED' },
];

const ms = (v: number) => (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toString());

/** One stacked horizontal bar; widths are shares of the total, with a tooltip per segment. */
export function TimeBar({ parts, className }: { parts: Parts; className?: string }) {
  const total = TIME_PARTS.reduce((s, p) => s + Math.max(0, parts[p.key]), 0);
  return (
    <div className={cn('flex h-2 w-full overflow-hidden rounded-full bg-surface-3', className)} role="img" aria-label={`Where the time went: ${total ? TIME_PARTS.map((p) => `${p.label} ${ms(parts[p.key])} ms`).join(', ') : 'no data'}`}>
      {total > 0 && TIME_PARTS.map((p) => {
        const v = Math.max(0, parts[p.key]);
        if (v <= 0) return null;
        return (
          <Tooltip key={p.key} content={`${p.label} · ${ms(v)} ms · ${Math.round((v / total) * 100)}% · ${p.provenance.toLowerCase()}`}>
            <span style={{ width: `${(v / total) * 100}%`, background: p.color }} className="h-full min-w-px" />
          </Tooltip>
        );
      })}
    </div>
  );
}

export function TimeLegend({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {TIME_PARTS.map((p) => (
        <li key={p.key} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
          {p.label}
          <span className="text-faint">{p.provenance.toLowerCase()}</span>
        </li>
      ))}
    </ul>
  );
}
