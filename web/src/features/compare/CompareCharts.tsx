import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMemo } from 'react';
import type { RunReport } from '@datasim/shared';
import { Section } from '../report/Section';
import { ChartCard } from '../charts';
import { AXIS, GRID, MARGIN, compact } from '../charts/common';
import { overlaySeries } from './diff';

/** One restrained colour per run, from the tokens plus the violet the charts already use for deadlocks. */
export const RUN_COLORS = ['var(--accent)', 'var(--info)', 'var(--warn)', '#a78bfa'] as const;

function OverlayTooltip({ active, payload, label, unit, labels }: { active?: boolean; payload?: { dataKey?: string | number; value?: unknown; color?: string }[]; label?: number | string; unit: string; labels: string[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface-2 px-2 py-1.5 text-xs">
      <div className="mb-1 font-mono text-[11px] text-faint">t = {label}s</div>
      {payload.filter((p) => typeof p.value === 'number').map((p) => {
        const i = Number(String(p.dataKey).slice(1));
        return (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />{labels[i]}</span>
            <span className="font-mono tnum text-fg">{(p.value as number).toLocaleString('en-US', { maximumFractionDigits: 0 })}{unit}</span>
          </div>
        );
      })}
    </div>
  );
}

function Overlay({ runs, labels, title, unit, pick, sloMs }: { runs: RunReport[]; labels: string[]; title: string; unit: string; pick: (s: RunReport['samples'][number]) => number; sloMs?: number }) {
  const data = useMemo(() => overlaySeries(runs, pick), [runs, pick]);
  return (
    <ChartCard title={title} provenance="MEASURED" height={220} legend={labels.map((l, i) => ({ label: l, color: RUN_COLORS[i]! }))} empty={data.length === 0 && 'No samples were recorded'}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={MARGIN}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="tS" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => `${v}s`} minTickGap={28} {...AXIS} />
          <YAxis width={40} tickFormatter={compact} {...AXIS} />
          <Tooltip content={<OverlayTooltip unit={unit} labels={labels} />} cursor={{ stroke: 'var(--line-strong)' }} isAnimationActive={false} />
          {sloMs ? <ReferenceLine y={sloMs} stroke="var(--faint)" strokeDasharray="4 3" /> : null}
          {runs.map((r, i) => <Line key={r.run.runId} dataKey={`r${i}`} name={labels[i]} type="monotone" stroke={RUN_COLORS[i]} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

const pickTps = (s: RunReport['samples'][number]) => s.tps;
const pickP95 = (s: RunReport['samples'][number]) => s.p95Ms;

export function CompareCharts({ runs, labels }: { runs: RunReport[]; labels: string[] }) {
  return (
    <Section id="charts" title="Over time" provenance="MEASURED" aside="seconds since the measured window started">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Overlay runs={runs} labels={labels} title="Throughput (tps)" unit=" tps" pick={pickTps} />
        <Overlay runs={runs} labels={labels} title="p95 latency (ms)" unit=" ms" pick={pickP95} sloMs={runs[0]?.design.slo.p95Ms} />
      </div>
    </Section>
  );
}
