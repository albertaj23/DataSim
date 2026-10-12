import { Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isTerminal, type RunReport } from '@datasim/shared';
import { api, errorMessage } from '../../lib/api';
import { shortId } from '../../lib/format';
import { useRunEvents } from '../../lib/socket';
import { Button, Pill, StatusDot, cn, useToast } from '../../ui';
import { DbChart, ErrorsChart, LatencyChart, TpsChart } from '../charts';
import { PHASES, appendSamples, applyFinished, applyProgress, applyStatus, begin, createSampleBuffer, describePhase, phaseFill, phaseIndex, type RunState } from '../studio/runStore';
import { measuredSamples } from './logic';
import { Panel } from './Section';

function PhaseBar({ s }: { s: RunState }) {
  const cur = phaseIndex(s.status);
  const failed = s.status === 'FAILED' || s.status === 'CANCELLED';
  return (
    <div className="grid min-w-0 flex-1 grid-cols-4 gap-2" role="progressbar" aria-label="Run phase" aria-valuetext={describePhase(s)}>
      {PHASES.map((label, i) => (
        <div key={label} className="min-w-0">
          <div className={cn('mb-1 truncate text-xs', i === cur ? 'font-medium text-fg' : i < cur ? 'text-muted' : 'text-faint')}>{label}</div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className={cn('h-full rounded-full transition-[width] duration-300 ease-out', failed && i >= cur ? 'bg-faint' : i === cur ? 'bg-info' : 'bg-accent')} style={{ width: `${Math.round(phaseFill(s, i) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** In-flight run (QUEUED..ANALYZING): phase, progress and live charts from the socket; hands over to the report when it finishes. */
export function LiveRun({ report, onDone }: { report: RunReport; onDone: () => void }) {
  const run = report.run;
  const toast = useToast();
  const [s, setS] = useState<RunState>(() => ({ ...begin(run.projectId, run.runId), status: run.status, phase: run.status }));
  const [cancelling, setCancelling] = useState(false);
  const buffer = useMemo(() => createSampleBuffer((b) => setS((x) => appendSamples(x, b))), []);
  useEffect(() => () => buffer.cancel(), [buffer]);

  useRunEvents(run.runId, {
    onStatus: (e) => setS((x) => applyStatus(x, e)),
    onProgress: (e) => setS((x) => applyProgress(x, e)),
    onSample: (e) => buffer.add(e.sample),
    onFinished: (e) => { buffer.flush(); setS((x) => applyFinished(x, e)); onDone(); },
  });

  // Safety net: if the socket drops, poll the run until it is terminal.
  useEffect(() => {
    const t = setInterval(async () => {
      const res = await api.get<RunReport>(`/runs/${run.runId}`);
      if (res.ok && isTerminal(res.body.run.status)) onDone();
    }, 3000);
    return () => clearInterval(t);
  }, [run.runId, onDone]);

  const samples = useMemo(() => measuredSamples(s.samples), [s.samples]);
  const sloMs = report.design.slo.p95Ms;
  const cancel = async () => {
    setCancelling(true);
    const res = await api.post(`/runs/${run.runId}/cancel`);
    if (!res.ok) { toast.error('Could not cancel', errorMessage(res)); setCancelling(false); }
  };
  const waiting = 'Waiting for the first sample';

  return (
    <div className="flex flex-col gap-4" data-testid="live-run">
      <header>
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted">
          <Link to="/runs" className="hover:text-fg">Runs</Link><span className="text-faint">/</span><span className="font-mono">{shortId(run.runId)}</span>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="truncate text-xl font-medium text-fg"><Link to={`/p/${run.projectId}`} className="hover:text-accent">{run.projectName ?? 'Project'}</Link></h1>
          <Pill tone="blue" className="h-6 px-2.5 text-xs font-medium" icon={<StatusDot status="info" pulse />}>Running</Pill>
        </div>
        <ul className="mt-2 flex flex-wrap items-center gap-1.5">
          {[`rev ${run.revisionNo}`, run.kind, run.strategy, run.isolation, `${run.vus} VUs`, `${run.durationS} s`].map((m) => <li key={m}><Pill mono>{m}</Pill></li>)}
        </ul>
      </header>

      <Panel className="flex items-center gap-5 px-4 py-3">
        <PhaseBar s={s} />
        <div className="flex shrink-0 items-center gap-3">
          <span className="w-[260px] truncate text-right font-mono text-xs text-muted tnum" data-testid="phase-text">{describePhase(s)}</span>
          <Button size="sm" variant="danger" icon={<Square size={12} />} loading={cancelling} onClick={() => void cancel()}>Cancel</Button>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <TpsChart samples={samples} height={200} syncId="live" emptyText={waiting} />
        <LatencyChart samples={samples} height={200} syncId="live" sloMs={sloMs} emptyText={waiting} />
        <ErrorsChart samples={samples} height={200} syncId="live" emptyText={waiting} />
        <DbChart samples={samples} height={200} syncId="live" emptyText={waiting} />
      </div>
      <p className="text-xs text-faint">The full report loads here as soon as the run finishes. Live numbers are measured; this view only streams them.</p>
    </div>
  );
}
