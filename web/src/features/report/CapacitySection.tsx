import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMemo } from 'react';
import type { CapacityResult, RunReport } from '@datasim/shared';
import { formatMs, formatNumber, formatPct } from '../../lib/format';
import { Pill, ProvenanceTag, TBody, TD, TH, THead, TR, Table, cn } from '../../ui';
import { ChartCard } from '../charts';
import { AXIS, GRID, MARGIN, SERIES, compact } from '../charts/common';
import { capacityCurve, hasFinitePeak, littleLine, littlesLaw } from './logic';
import { Panel, Section } from './Section';

const MARGIN_R = { ...MARGIN, right: 18 };
const cursor = { stroke: 'var(--line-strong)' };

function VusTooltip({ active, payload, label, unit = '' }: { active?: boolean; payload?: { name?: string | number; value?: unknown; color?: string; dataKey?: string | number }[]; label?: string | number; unit?: string }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => typeof p.value === 'number');
  if (!rows.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface-2 px-2 py-1.5 text-xs">
      <div className="mb-1 font-mono text-[11px] text-faint">{label} VUs</div>
      {rows.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />{p.name}</span>
          <span className="font-mono tnum text-fg">{formatNumber(p.value as number, 0)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, sub, provenance, tone }: { label: string; value: string; sub?: string; provenance?: 'MEASURED' | 'PROJECTED'; tone?: 'bad' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2"><span className="truncate text-xs text-muted">{label}</span>{provenance && <ProvenanceTag kind={provenance} />}</div>
      <div className={cn('font-mono text-base tnum', tone === 'bad' ? 'text-bad' : 'text-fg')}>{value}</div>
      {sub && <div className="truncate text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

export function CapacitySection({ report, capacity }: { report: RunReport; capacity: CapacityResult }) {
  const slo = report.design.slo;
  const { rows, maxTested, end } = useMemo(() => capacityCurve(capacity.points, capacity.fit), [capacity]);
  const measured = useMemo(() => rows.filter((r) => r.tps !== undefined), [rows]);
  const fit = capacity.fit;
  const peak = hasFinitePeak(fit, maxTested) ? fit : null;
  const little = littlesLaw(report.settings);
  const littleBy = new Map(little.map((l) => [l.vus, l]));
  const refVus = (report.settings.capacity as { refStepVus?: number } | undefined)?.refStepVus;
  const ticks = capacity.points.map((p) => p.vus);

  return (
    <Section id="capacity" title="Capacity" aside={refVus ? `summary metrics and sections below come from the ${refVus}-VU step` : undefined}>
      <div className="flex flex-col gap-3">
        <Panel className="flex flex-col gap-1 px-4 py-3">
          <div className="flex items-center gap-2"><span className="text-xs text-muted">Verdict</span><ProvenanceTag kind={fit ? 'PROJECTED' : 'MEASURED'} /></div>
          <p className="text-sm text-fg" data-testid="capacity-sentence">{capacity.sentence || 'No capacity verdict was produced.'}</p>
        </Panel>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Stat label="Knee" value={capacity.kneeVus != null ? `${capacity.kneeVus} VUs` : 'none'} sub={capacity.kneeVus != null ? 'SLO break or flat TPS + p95 growth' : 'within tested load'} provenance="MEASURED" tone={capacity.kneeVus != null ? 'bad' : undefined} />
          <Stat label="Sustained" value={capacity.sustainedVus != null ? `${capacity.sustainedVus} VUs` : 'none'} sub={`p95 ≤ ${formatMs(slo.p95Ms)}`} provenance="MEASURED" />
          <Stat label="Peak N*" value={fit ? (peak ? `${formatNumber(fit.nPeak)} VUs` : 'no peak') : '-'} sub={fit && !peak ? 'no retrograde region' : 'where X(N) tops out'} provenance="PROJECTED" />
          <Stat label="X max" value={fit ? `${formatNumber(fit.xMax)} tps` : '-'} sub="USL ceiling" provenance="PROJECTED" />
          <Stat label="R²" value={fit ? fit.r2.toFixed(3) : '-'} sub={fit ? `σ ${fit.sigma.toExponential(2)} · κ ${fit.kappa.toExponential(2)}` : 'fit unavailable'} provenance="PROJECTED" />
          <Stat label="Steps" value={String(capacity.points.length)} sub={capacity.points.map((p) => p.vus).join(' · ')} provenance="MEASURED" />
        </div>

        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          <ChartCard
            title="Throughput vs VUs" height={240}
            legend={[{ label: 'measured', color: 'var(--fg)' }, ...(fit ? [{ label: 'USL fit', color: SERIES.tps }, { label: 'PROJECTED', color: SERIES.tps, dashed: true }] : [])]}
            empty={capacity.points.length === 0 && 'No capacity steps completed'}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={MARGIN_R}>
                <CartesianGrid {...GRID} />
                <XAxis type="number" dataKey="n" domain={[0, end]} ticks={ticks.length ? ticks : undefined} interval={0} tickFormatter={(v: number) => String(v)} {...AXIS} />
                <YAxis width={40} tickFormatter={compact} {...AXIS} />
                <Tooltip content={<VusTooltip unit=" tps" />} cursor={cursor} isAnimationActive={false} />
                {fit && end > maxTested && <ReferenceArea x1={maxTested} x2={end} fill="var(--info)" fillOpacity={0.05} stroke="none" label={{ value: 'PROJECTED', position: 'insideTopRight', fill: 'var(--faint)', fontSize: 10 }} />}
                {capacity.kneeVus != null && <ReferenceLine x={capacity.kneeVus} stroke="var(--bad)" strokeDasharray="3 3" label={{ value: 'knee', position: 'insideTopLeft', fill: 'var(--bad)', fontSize: 10 }} />}
                {peak && peak.nPeak <= end && <ReferenceLine x={peak.nPeak} stroke="var(--info)" strokeDasharray="3 3" label={{ value: 'N*', position: 'insideTopRight', fill: 'var(--info)', fontSize: 10 }} />}
                {fit && <Line dataKey="fit" name="USL fit" stroke={SERIES.tps} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
                {fit && <Line dataKey="proj" name="projected" stroke={SERIES.tps} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />}
                <Line dataKey="tps" name="measured" stroke="transparent" dot={{ r: 3.5, fill: 'var(--fg)', stroke: 'var(--surface)', strokeWidth: 1.5 }} activeDot={{ r: 4.5 }} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="p95 vs VUs" provenance="MEASURED" height={240}
            legend={[{ label: 'p95', color: SERIES.p95 }, { label: 'SLO', color: 'var(--faint)', dashed: true }]}
            empty={capacity.points.length === 0 && 'No capacity steps completed'}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={measured} margin={MARGIN_R}>
                <CartesianGrid {...GRID} />
                <XAxis type="number" dataKey="n" domain={[0, maxTested]} ticks={ticks.length ? ticks : undefined} interval={0} tickFormatter={(v: number) => String(v)} {...AXIS} />
                <YAxis width={40} tickFormatter={compact} {...AXIS} />
                <Tooltip content={<VusTooltip unit=" ms" />} cursor={cursor} isAnimationActive={false} />
                <ReferenceLine y={slo.p95Ms} stroke="var(--faint)" strokeDasharray="4 3" />
                {capacity.kneeVus != null && <ReferenceLine x={capacity.kneeVus} stroke="var(--bad)" strokeDasharray="3 3" label={{ value: 'knee', position: 'insideTopLeft', fill: 'var(--bad)', fontSize: 10 }} />}
                <Line dataKey="p95" name="p95" stroke={SERIES.p95} strokeWidth={1.5} dot={{ r: 3.5, fill: SERIES.p95, stroke: 'var(--surface)', strokeWidth: 1.5 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <Table>
          <THead>
            <TR><TH align="right">Step</TH><TH align="right">VUs</TH><TH align="right">TPS</TH><TH align="right">p50</TH><TH align="right">p95</TH><TH align="right">Error rate</TH><TH align="right">X·(R+Z)</TH><TH>SLO</TH></TR>
          </THead>
          <TBody>
            {capacity.points.map((p) => {
              const breach = p.p95Ms > slo.p95Ms || p.errorRate * 100 > slo.maxErrorPct;
              const l = littleBy.get(p.vus);
              return (
                <TR key={p.stepNo} data-testid="capacity-row">
                  <TD align="right" mono className="text-muted">{p.stepNo}</TD>
                  <TD align="right" mono>{p.vus}{p.vus === capacity.kneeVus && <Pill tone="red" className="ml-2">knee</Pill>}</TD>
                  <TD align="right" mono>{formatNumber(p.tps)}</TD>
                  <TD align="right" mono>{formatMs(p.p50Ms)}</TD>
                  <TD align="right" mono className={cn(breach && 'text-bad')}>{formatMs(p.p95Ms)}</TD>
                  <TD align="right" mono>{formatPct(p.errorRate, 2)}</TD>
                  <TD align="right" mono className="text-muted">{l ? l.predicted.toFixed(1) : '-'}</TD>
                  <TD>{breach ? <Pill tone="red">breach</Pill> : <Pill tone="green">within</Pill>}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>

        {little.length > 0 && (
          <div className="flex flex-col gap-1 text-xs text-muted" data-testid="little-check">
            <span className="flex items-center gap-1.5 text-fg">Little&apos;s law check <ProvenanceTag kind="MEASURED" /><span className="text-muted">N ≈ X·(R+Z), predicted concurrency per step</span></span>
            <span className="flex flex-wrap gap-x-4 gap-y-1">{little.map((l) => { const c = littleLine(l); return <span key={l.vus} className={cn('font-mono tnum', c.ok ? 'text-muted' : 'text-warn')}>{c.text}</span>; })}</span>
          </div>
        )}
      </div>
    </Section>
  );
}
