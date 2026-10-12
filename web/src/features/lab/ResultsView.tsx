import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard } from '../charts';
import { AXIS, GRID } from '../charts/common';
import { Table, TBody, TD, TH, THead, TR, cn } from '../../ui';
import { formatMs, formatNumber } from '../../lib/format';
import { CHART_METRICS, MEAN_NOTE, fmtMean, meanTitle, metricOf, type ChartMetric, type ResultRow } from './logic';
import { Segmented, TableNote } from './widgets';

const num = fmtMean;

/** Results table. `lost` swaps the deadlocks column for nothing and renames violations to lost increments. */
export function ResultsTable({ rows, kind }: { rows: ResultRow[]; kind: 'stream' | 'lost' }) {
  return (
    <div>
    <Table aria-label="Experiment results">
      <THead>
        <tr>
          <TH>{kind === 'stream' ? 'Strategy' : 'Variant'}</TH>
          <TH>Isolation</TH>
          <TH align="right">Trials</TH>
          <TH align="right">{kind === 'stream' ? 'Violations' : 'Lost updates'}</TH>
          <TH align="right">Trials hit</TH>
          <TH align="right">Retries / trial</TH>
          {kind === 'stream' && <TH align="right">Deadlocks / trial</TH>}
          <TH align="right">Errors</TH>
          <TH align="right">p50</TH>
          <TH align="right">p95</TH>
          {kind === 'stream' && <TH align="right">Throughput</TH>}
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.key}>
            <TD mono className="font-medium">{r.name}</TD>
            <TD className="text-xs text-muted">{r.isolation}</TD>
            <TD align="right" mono>{r.trials}</TD>
            <TD align="right" mono className={cn(r.violations > 0 ? 'font-medium text-bad' : 'text-ok')}>{formatNumber(r.violations)}</TD>
            <TD align="right" mono className="text-muted">{r.violatingPct}%</TD>
            <TD align="right" mono title={meanTitle(r.retries, r.trials)}>{num(r.retries)}</TD>
            {kind === 'stream' && <TD align="right" mono title={meanTitle(r.deadlocks, r.trials)} className={cn(r.deadlocks > 0 && 'text-warn')}>{num(r.deadlocks)}</TD>}
            <TD align="right" mono className={cn(r.errors > 0 && 'text-bad')}>{formatNumber(r.errors)}</TD>
            <TD align="right" mono className="whitespace-nowrap">{formatMs(r.p50)}</TD>
            <TD align="right" mono className="whitespace-nowrap">{formatMs(r.p95)}</TD>
            {kind === 'stream' && <TD align="right" mono>{num(r.rps)}/s</TD>}
          </TR>
        ))}
      </TBody>
    </Table>
    <TableNote>{MEAN_NOTE}</TableNote>
    </div>
  );
}

/** Horizontal bar per strategy for one metric. Violations are red when non-zero, green when zero. */
export function ResultsChart({ rows, metrics = CHART_METRICS }: { rows: ResultRow[]; metrics?: typeof CHART_METRICS }) {
  const [metric, setMetric] = useState<ChartMetric>('violations');
  const def = metrics.find((m) => m.value === metric) ?? metrics[0]!;
  const data = rows.map((r) => ({ name: r.name, value: metricOf(r, def.value) }));
  const color = (v: number) => (def.value === 'violations' ? (v > 0 ? 'var(--bad)' : 'var(--ok)') : def.value === 'p95' ? 'var(--warn)' : def.value === 'rps' ? 'var(--accent)' : 'var(--info)');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">Compare by</span>
        <Segmented label="Chart metric" value={metric} onChange={setMetric} options={metrics.map((m) => ({ value: m.value, label: m.label }))} />
      </div>
      <ChartCard title={def.label} provenance="MEASURED" height={Math.max(150, rows.length * 28 + 28)} legend={def.value === 'violations' ? [{ label: def.label.toLowerCase(), color: 'var(--bad)' }, { label: 'none', color: 'var(--ok)' }] : undefined}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 2, right: 44, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID} vertical horizontal={false} />
            <XAxis type="number" allowDecimals={def.value === 'p95' || def.value === 'retries'} {...AXIS} />
            <YAxis type="category" dataKey="name" width={96} interval={0} {...AXIS} />
            <Tooltip
              cursor={{ fill: 'var(--surface-3)' }}
              isAnimationActive={false}
              content={({ active, payload }) => active && payload?.length ? (
                <div className="rounded-md border border-line bg-surface-2 px-2 py-1.5 text-xs">
                  <span className="text-muted">{String(payload[0]!.payload.name)}</span>{' '}
                  <span className="font-mono tnum text-fg">{num(Number(payload[0]!.value))}{def.unit}</span>
                </div>
              ) : null}
            />
            <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false} barSize={14}>
              {data.map((d) => <Cell key={d.name} fill={color(d.value)} />)}
              <LabelList dataKey="value" position="right" formatter={(v: number) => num(v)} style={{ fill: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
