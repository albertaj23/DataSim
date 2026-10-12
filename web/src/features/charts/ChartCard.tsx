import type { Provenance } from '@datasim/shared';
import type { ReactNode } from 'react';
import { ProvenanceTag, cn } from '../../ui';

export interface LegendItem { label: string; color: string; dashed?: boolean }

/** Shared chrome for every chart: title, provenance tag, inline legend and a fixed-height plot area. */
export function ChartCard({ title, provenance, legend, height, empty, children, className }: {
  title: string; provenance?: Provenance; legend?: LegendItem[]; /** px; omit to fill the card. */ height?: number; empty?: string | false; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-lg border border-line bg-surface p-2.5', className)}>
      <header className="mb-1.5 flex h-[18px] items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h4 className="truncate text-xs font-medium text-fg">{title}</h4>
          {provenance && <ProvenanceTag kind={provenance} />}
        </div>
        {legend && (
          <ul className="flex shrink-0 items-center gap-2.5">
            {legend.map((l) => (
              <li key={l.label} className="flex items-center gap-1 text-[11px] text-muted">
                <span className="inline-block h-[2px] w-2.5 rounded-full" style={{ background: l.dashed ? 'transparent' : l.color, borderTop: l.dashed ? `2px dashed ${l.color}` : undefined }} />
                {l.label}
              </li>
            ))}
          </ul>
        )}
      </header>
      {/* Fixed height when given, otherwise fills the card (min 120px). The chart sits in an absolute box so ResponsiveContainer always has a size. */}
      <div className={cn('relative min-w-0', height == null && 'min-h-[120px] flex-1')} style={height != null ? { height } : undefined}>
        <div className="absolute inset-0">{children}</div>
        {empty && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-faint">{empty}</div>}
      </div>
    </section>
  );
}
