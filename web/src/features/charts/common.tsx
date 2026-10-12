import type { ReactNode } from 'react';
import type { RunSample } from '@datasim/shared';

/** Series colours: one place so every chart (Studio, report, compare) agrees. */
export const SERIES = {
  tps: 'var(--accent)',
  p50: 'var(--info)',
  p95: 'var(--warn)',
  p99: 'var(--bad)',
  errors: 'var(--bad)',
  retries: 'var(--warn)',
  deadlocks: '#a78bfa',
  threads: 'var(--info)',
  lockWaits: 'var(--warn)',
} as const;

export interface BaseChartProps {
  samples: RunSample[];
  height?: number;
  /** Recharts syncId so hover lines up across charts. */
  syncId?: string;
  className?: string;
  /** Shown when `samples` is empty. */
  emptyText?: string;
}

export const AXIS = { stroke: 'var(--faint)', fontSize: 10, tickLine: false, axisLine: { stroke: 'var(--line)' } } as const;
export const GRID = { stroke: 'var(--line)', strokeDasharray: '2 4', vertical: false } as const;
export const MARGIN = { top: 4, right: 6, bottom: 0, left: 0 } as const;
/** 1,050 -> 1.1k so y-axis labels never clip. */
export const compact = (v: number) => (Math.abs(v) >= 1000 ? `${Number((v / 1000).toFixed(1))}k` : String(v));

export const fmtNum = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d }) : '-');

/** Dark compact tooltip for recharts (`<Tooltip content={<ChartTooltip unit=" ms" />} />`). */
export function ChartTooltip({ active, payload, label, unit = '', digits = 0 }: {
  active?: boolean; payload?: { name?: string | number; value?: unknown; color?: string }[]; label?: ReactNode; unit?: string; digits?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface-2 px-2 py-1.5 text-xs">
      <div className="mb-1 font-mono text-[11px] text-faint">t = {label}s</div>
      {payload.map((p) => (
        <div key={String(p.name)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />{p.name}</span>
          <span className="font-mono tnum text-fg">{fmtNum(p.value, digits)}{unit}</span>
        </div>
      ))}
    </div>
  );
}
