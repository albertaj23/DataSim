import { CircleCheck, CircleX, Play, Square } from 'lucide-react';
import { useMemo } from 'react';
import { useDesignStore } from '../../../lib/designStore';
import { formatMs } from '../../../lib/format';
import { Button, EmptyState, Pill, cn } from '../../../ui';
import { DbChart, ErrorsChart, InvariantsChart, LatencyChart, TpsChart } from '../../charts';
import { isCompareReport } from '../compare';
import type { useRunActions } from '../runFlow';
import { PHASES, describePhase, isActive, phaseFill, phaseIndex, useRunStore } from '../runStore';
import { CompareLive } from './CompareLive';

function PhaseBar() {
  const s = useRunStore();
  const cur = phaseIndex(s.status);
  const failed = s.status === 'FAILED' || s.status === 'CANCELLED';
  return (
    <div className="grid min-w-0 flex-1 grid-cols-4 gap-1.5" role="progressbar" aria-label="Run phase" aria-valuetext={describePhase(s)}>
      {PHASES.map((label, i) => {
        const fill = phaseFill(s, i);
        const current = i === cur;
        return (
          <div key={label} className="min-w-0">
            <div className={cn('mb-1 truncate text-[11px]', current ? 'font-medium text-fg' : i < cur ? 'text-muted' : 'text-faint')}>{label}</div>
            <div className="h-1 overflow-hidden rounded-full bg-surface-3">
              <div className={cn('h-full rounded-full transition-[width] duration-300 ease-out', failed && i >= cur ? 'bg-faint' : current ? 'bg-info' : 'bg-accent')} style={{ width: `${Math.round(fill * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LiveTab({ run }: { run: ReturnType<typeof useRunActions> }) {
  const runId = useRunStore((s) => s.runId);
  const active = useRunStore(isActive);
  const samples = useRunStore((s) => s.samples);
  const report = useRunStore((s) => s.report);
  const phase = useRunStore((s) => describePhase(s));
  const sloMs = useDesignStore((s) => s.design.slo.p95Ms);
  const isCompare = useRunStore((s) => s.children.length > 0) || isCompareReport(report);
  const verdict = !active ? report?.slo ?? null : null;
  const failedRun = !active && report && (report.run.status === 'FAILED');
  const chartData = useMemo(() => samples, [samples]);

  if (!runId) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <EmptyState
          className="w-full max-w-[520px] border-0 py-6" title="No run yet"
          description="Run the design to stream throughput, latency, errors and database load here."
          actions={<Button variant="primary" size="sm" icon={<Play size={14} />} onClick={() => void run.start('LOAD')}>Run load test</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-auto p-3">
      <div className="flex items-center gap-4">
        <PhaseBar />
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="font-mono text-xs text-muted tnum" data-testid="phase-text">{phase}</span>
          {active && <Button size="sm" variant="danger" icon={<Square size={12} />} onClick={() => void run.cancel()}>Cancel</Button>}
        </div>
      </div>

      {isCompare && <CompareLive active={active} />}

      {!isCompare && !active && report && (
        <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs', failedRun ? 'border-bad/30 bg-bad/5' : verdict ? (verdict.pass ? 'border-ok/30 bg-ok/5' : 'border-bad/30 bg-bad/5') : 'border-line bg-surface')} data-testid="verdict">
          {verdict ? (
            <>
              <Pill tone={verdict.pass ? 'green' : 'red'} className="font-medium" icon={verdict.pass ? <CircleCheck size={11} /> : <CircleX size={11} />}>{verdict.pass ? 'PASS' : 'FAIL'}</Pill>
              <span className="text-fg">{verdict.pass ? `p95 ${formatMs(report.run.p95Ms)} within ${report.design.slo.p95Ms} ms, errors within ${report.design.slo.maxErrorPct}%.` : verdict.reasons.join(' · ')}</span>
            </>
          ) : failedRun ? (
            <><Pill tone="red" className="font-medium">FAILED</Pill><span className="text-fg">{report.run.errorText ?? 'The run stopped with an error.'}</span></>
          ) : (
            <span className="text-muted">Run {report.run.status.toLowerCase()}. No SLO verdict.</span>
          )}
          <span className="ml-auto flex items-center gap-3 font-mono text-muted tnum">
            <span>{Math.round(report.run.tpsAvg).toLocaleString('en-US')} tps</span>
            <span>p95 {formatMs(report.run.p95Ms)}</span>
            <span className={report.run.invariantViolations > 0 ? 'text-bad' : undefined}>{report.run.invariantViolations} violations</span>
          </span>
        </div>
      )}

      {(!isCompare || active) && (
      <div className="grid min-h-[150px] flex-1 grid-cols-2 gap-2 xl:grid-cols-4">
        <TpsChart samples={chartData} height={undefined} className="h-full" syncId="live" emptyText={active ? 'Waiting for the first sample' : 'No samples'} />
        <LatencyChart samples={chartData} sloMs={sloMs} className="h-full" syncId="live" emptyText={active ? 'Waiting for the first sample' : 'No samples'} />
        <ErrorsChart samples={chartData} className="h-full" syncId="live" emptyText={active ? 'Waiting for the first sample' : 'No samples'} />
        <DbChart samples={chartData} className="h-full" syncId="live" emptyText={active ? 'Waiting for the first sample' : 'No samples'} />
      </div>
      )}
      {!isCompare && <InvariantsChart samples={chartData} height={96} syncId="live" className="shrink-0" />}
    </div>
  );
}
