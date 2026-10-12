import type { RunReport } from '@datasim/shared';
import { ProvenanceTag, toneText, cn } from '../../ui';
import { buildKpis } from './logic';

/** 10 headline numbers, 5 per row. Each carries its provenance tag. */
export function KpiStrip({ report }: { report: RunReport }) {
  const kpis = buildKpis(report);
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5" data-testid="kpi-strip">
      {kpis.map((k) => (
        <div key={k.key} data-testid={`kpi-${k.key}`} className="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted">{k.label}</span>
            <ProvenanceTag kind={k.provenance} />
          </div>
          <div className={cn('font-mono text-xl font-medium tnum', k.tone === 'neutral' ? 'text-fg' : toneText[k.tone])}>{k.value}</div>
          <div className="truncate text-[11px] text-faint">{k.sub}</div>
        </div>
      ))}
    </div>
  );
}
