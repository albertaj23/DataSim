import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard } from './ChartCard';
import { AXIS, ChartTooltip, compact, GRID, MARGIN, SERIES, type BaseChartProps } from './common';

// All charts take plain RunSample[]: the Studio feeds them the live ring buffer, the report feeds them the persisted samples.
// Animation is off everywhere: recharts re-animates on every data push and that janks at 1-2 Hz.

const xAxis = <XAxis dataKey="tS" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => `${v}s`} minTickGap={28} {...AXIS} />;
const cursor = { stroke: 'var(--line-strong)' };

export function TpsChart({ samples, height, syncId, className, emptyText }: BaseChartProps) {
  return (
    <ChartCard title="Throughput" provenance="MEASURED" legend={[{ label: 'tps', color: SERIES.tps }]} height={height} className={className} empty={samples.length === 0 && (emptyText ?? 'No samples yet')}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={samples} syncId={syncId} margin={MARGIN}>
          <CartesianGrid {...GRID} />
          {xAxis}
          <YAxis width={34} allowDecimals={false} tickFormatter={compact} {...AXIS} />
          <Tooltip content={<ChartTooltip />} cursor={cursor} isAnimationActive={false} />
          <Area dataKey="tps" name="tps" type="monotone" stroke={SERIES.tps} strokeWidth={1.5} fill={SERIES.tps} fillOpacity={0.1} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function LatencyChart({ samples, height, syncId, className, emptyText, sloMs }: BaseChartProps & { sloMs?: number }) {
  return (
    <ChartCard
      title="Latency" provenance="MEASURED" height={height} className={className} empty={samples.length === 0 && (emptyText ?? 'No samples yet')}
      legend={[{ label: 'p50', color: SERIES.p50 }, { label: 'p95', color: SERIES.p95 }, { label: 'p99', color: SERIES.p99 }]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={samples} syncId={syncId} margin={MARGIN}>
          <CartesianGrid {...GRID} />
          {xAxis}
          <YAxis width={34} tickFormatter={compact} {...AXIS} />
          <Tooltip content={<ChartTooltip unit=" ms" />} cursor={cursor} isAnimationActive={false} />
          {sloMs ? <ReferenceLine y={sloMs} stroke="var(--faint)" strokeDasharray="4 3" /> : null}
          <Line dataKey="p50Ms" name="p50" type="monotone" stroke={SERIES.p50} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line dataKey="p95Ms" name="p95" type="monotone" stroke={SERIES.p95} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line dataKey="p99Ms" name="p99" type="monotone" stroke={SERIES.p99} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ErrorsChart({ samples, height, syncId, className, emptyText }: BaseChartProps) {
  return (
    <ChartCard
      title="Errors" provenance="MEASURED" height={height} className={className} empty={samples.length === 0 && (emptyText ?? 'No samples yet')}
      legend={[{ label: 'err', color: SERIES.errors }, { label: 'retry', color: SERIES.retries }, { label: 'dead', color: SERIES.deadlocks }]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={samples} syncId={syncId} margin={MARGIN}>
          <CartesianGrid {...GRID} />
          {xAxis}
          <YAxis width={34} allowDecimals={false} tickFormatter={compact} {...AXIS} />
          <Tooltip content={<ChartTooltip />} cursor={cursor} isAnimationActive={false} />
          <Line dataKey="errors" name="errors" type="stepAfter" stroke={SERIES.errors} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line dataKey="retries" name="retries" type="stepAfter" stroke={SERIES.retries} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line dataKey="deadlocks" name="deadlocks" type="stepAfter" stroke={SERIES.deadlocks} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function DbChart({ samples, height, syncId, className, emptyText }: BaseChartProps) {
  return (
    <ChartCard
      title="Database" provenance="MEASURED" height={height} className={className} empty={samples.length === 0 && (emptyText ?? 'No samples yet')}
      legend={[{ label: 'threads', color: SERIES.threads }, { label: 'lock waits', color: SERIES.lockWaits }]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={samples} syncId={syncId} margin={MARGIN}>
          <CartesianGrid {...GRID} />
          {xAxis}
          <YAxis width={34} allowDecimals={false} tickFormatter={compact} {...AXIS} />
          <Tooltip content={<ChartTooltip />} cursor={cursor} isAnimationActive={false} />
          <Line dataKey="threadsRunning" name="threads running" type="monotone" stroke={SERIES.threads} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line dataKey="rowLockWaits" name="lock waits" type="stepAfter" stroke={SERIES.lockWaits} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
