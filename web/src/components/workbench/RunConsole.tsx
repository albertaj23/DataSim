import { useEffect, useState } from 'react';
import { Activity, Ban, CheckCircle2, CircleAlert, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { Badge, Button } from '../ui';
import { api, type ErrorBody } from '../../lib/api';
import type { RunConfiguration, RunEvent, RunSummary, ValidationProblem, ValidationResponse, Workspace } from '../../lib/workspaces';
import { ExperimentBatchesPanel } from './ExperimentBatchesPanel';

const initialConfiguration: RunConfiguration = { runMode: 'LIVE_DBMS', isolation: 'READ COMMITTED', concurrency: 2, trials: 1, seed: 1, timeoutMs: 15000 };
const sourceLabel: Record<RunEvent['source'], string> = {
  DBMS_OBSERVED: 'Observed by MySQL', DATASIM_DERIVED: 'Derived by DataSim', MODELED: 'Modeled behavior',
};

function bodyError(body: unknown, fallback: string): string {
  return (body as ErrorBody | undefined)?.message || fallback;
}

export function RunConsole({ workspace, isDirty }: { workspace: Workspace; isDirty: boolean }) {
  const [configuration, setConfiguration] = useState<RunConfiguration>(() => ({ ...initialConfiguration, concurrency: workspace.definition.actors.length }));
  const [validation, setValidation] = useState<{ valid: boolean; problems: ValidationProblem[] } | null>(null);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [selected, setSelected] = useState<RunEvent | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    async function poll(runId: string) {
      try {
        const [runResult, eventResult] = await Promise.all([
          api.get<RunSummary>(`/runs/${runId}`),
          api.get<RunEvent[]>(`/runs/${runId}/events`),
        ]);
        if (!live) return;
        if (!runResult.ok) throw new Error(bodyError(runResult.body, 'Could not read run state.'));
        if (!eventResult.ok) throw new Error(bodyError(eventResult.body, 'Could not read run evidence.'));
        setRun(runResult.body);
        setEvents(eventResult.body);
        setSelected((current) => current ? eventResult.body.find((event) => event.sequence === current.sequence) ?? current : eventResult.body.at(-1) ?? null);
        if (runResult.body.status === 'QUEUED' || runResult.body.status === 'RUNNING') timer = window.setTimeout(() => void poll(runId), 700);
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : 'Could not read run evidence.');
      }
    }
    if (run && (run.status === 'QUEUED' || run.status === 'RUNNING')) timer = window.setTimeout(() => void poll(run.id), 350);
    return () => { live = false; if (timer) window.clearTimeout(timer); };
  }, [run?.id, run?.status]);

  async function validate() {
    setBusy(true); setError('');
    try {
      const result = await api.post<ValidationResponse>(`/workspaces/${workspace.id}/validate`, {});
      if (!result.ok) throw new Error(bodyError(result.body, 'Workspace validation failed.'));
      setValidation(result.body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Workspace validation failed.');
    } finally { setBusy(false); }
  }

  async function start() {
    setBusy(true); setError(''); setValidation(null); setEvents([]); setRun(null); setSelected(null);
    try {
      const result = await api.post<{ runId?: string; status?: string; revision?: number; revisionHash?: string; code?: string; message?: string; problems?: ValidationProblem[] }>(`/workspaces/${workspace.id}/runs`, configuration);
      if (!result.ok) {
        if (result.body.problems) setValidation({ valid: false, problems: result.body.problems });
        throw new Error(bodyError(result.body, 'Could not start the run.'));
      }
      if (!result.body.runId) throw new Error('The server accepted the run without returning its run ID.');
      const initial = await api.get<RunSummary>(`/runs/${result.body.runId}`);
      if (!initial.ok) throw new Error(bodyError(initial.body, 'The run was queued but could not be loaded.'));
      setRun(initial.body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the run.');
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (!run) return;
    const result = await api.post(`/runs/${run.id}/cancel`, {});
    if (!result.ok) setError(bodyError(result.body, 'Could not cancel the run.'));
    else {
      const refreshed = await api.get<RunSummary>(`/runs/${run.id}`);
      if (refreshed.ok) setRun(refreshed.body);
    }
  }

  const running = run?.status === 'QUEUED' || run?.status === 'RUNNING';
  const completed = run?.status === 'COMPLETED';
  const violations = run?.summary?.violations ?? 0;

  return (
    <section className="workbench-console space-y-4" aria-labelledby="run-setup-title">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="workbench-eyebrow"><Activity size={14} /> EXECUTION / EVIDENCE</p><h2 id="run-setup-title" className="text-xl font-semibold">Run console</h2></div>
        {run && <Badge tone={run.status === 'COMPLETED' ? (violations ? 'red' : 'green') : running ? 'amber' : 'red'}>{run.status}</Badge>}
      </header>
      <div className="workbench-panel grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.75fr)]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="workbench-control">Run mode
              <select value={configuration.runMode} onChange={(event) => setConfiguration({ ...configuration, runMode: event.target.value as RunConfiguration['runMode'] })} className="workbench-input w-full">
                <option value="LIVE_DBMS">Live DBMS · concurrent actors</option>
                <option value="GUIDED_SCHEDULE">Guided schedule · explicit barriers</option>
                <option value="CONCEPT_MODEL" disabled>Concept model · not executable in this release</option>
              </select>
            </label>
            <label className="workbench-control">InnoDB isolation
              <select value={configuration.isolation} onChange={(event) => setConfiguration({ ...configuration, isolation: event.target.value as RunConfiguration['isolation'] })} className="workbench-input w-full">
                <option>READ COMMITTED</option><option>REPEATABLE READ</option><option>SERIALIZABLE</option>
              </select>
            </label>
            <label className="workbench-control">Concurrent actors
              <select value={configuration.concurrency ?? workspace.definition.actors.length} onChange={(event) => setConfiguration({ ...configuration, concurrency: Number(event.target.value) })} className="workbench-input w-full">
                {workspace.definition.actors.map((actor, index) => <option key={actor.id} value={index + 1}>{index + 1} actor{index === 0 ? '' : 's'}{index === workspace.definition.actors.length - 1 ? ' · all lanes' : ''}</option>)}
              </select>
            </label>
            <label className="workbench-control">Trials (max 10)
              <input type="number" min={1} max={10} value={configuration.trials} onChange={(event) => setConfiguration({ ...configuration, trials: Math.max(1, Math.min(10, Number(event.target.value))) })} className="workbench-input w-full" />
            </label>
            <label className="workbench-control">Seed (recorded)
              <input type="number" min={0} value={configuration.seed} onChange={(event) => setConfiguration({ ...configuration, seed: Math.max(0, Number(event.target.value)) })} className="workbench-input w-full" />
            </label>
          </div>
          <div className="rounded-lg border border-sky-300/15 bg-sky-300/5 px-3 py-2 text-xs text-stone-400">
            MySQL 8.4 / InnoDB · up to 8 actors · ≤ 10 trials · 30 s maximum. Typed operations only; user-authored SQL is never executed. The seed is recorded for reproducibility metadata; this initial runner does not randomize actor schedules.
            {configuration.runMode === 'GUIDED_SCHEDULE' && <span className="mt-1 block">Barrier operations coordinate actors at the same declared schedule point.</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void validate()} disabled={busy || running}><ShieldCheck size={14} /> Validate</Button>
            <Button variant="play" onClick={() => void start()} disabled={busy || running || isDirty || validation?.valid === false || validation === null}>
              <Play size={14} /> {busy ? 'Preparing…' : isDirty ? 'Save before running' : 'Run against MySQL'}
            </Button>
            {running && <Button variant="danger" onClick={() => void cancel()}><Ban size={14} /> Cancel run</Button>}
          </div>
          {validation && <div role="status" className={`rounded-lg border p-3 text-sm ${validation.valid ? 'border-emerald-400/25 bg-emerald-500/5 text-emerald-200' : 'border-amber-400/25 bg-amber-500/5 text-amber-200'}`}>
            {validation.valid ? 'Workspace is valid for a MySQL run.' : `Fix ${validation.problems.length} validation issue${validation.problems.length === 1 ? '' : 's'} before running.`}
            {!!validation.problems.length && <ul className="mt-2 list-disc space-y-1 pl-5">{validation.problems.map((problem, index) => <li key={`${problem.path}-${index}`}><code>{problem.path || 'workspace'}</code> — {problem.message}</li>)}</ul>}
          </div>}
          {error && <div role="alert" className="flex gap-2 rounded-lg border border-rose-400/25 bg-rose-500/5 p-3 text-sm text-rose-200"><CircleAlert size={16} className="shrink-0" />{error}</div>}
        </div>

        {run && <div className="rounded-xl border border-fg/8 bg-black/10 p-3">
          <div className="flex items-center justify-between gap-2"><p className="workbench-eyebrow">PINNED REPRODUCIBILITY</p><button aria-label="Refresh run" onClick={() => void api.get<RunSummary>(`/runs/${run.id}`).then((result) => result.ok && setRun(result.body))} className="text-stone-400 hover:text-white"><RefreshCw size={14} /></button></div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] text-stone-400">
            <dt>Run</dt><dd className="truncate">{run.id}</dd>
            <dt>Mode</dt><dd>{run.runMode}</dd><dt>Source</dt><dd>r{run.revision} · {run.revisionHash.slice(0, 12)}</dd>
            <dt>Engine</dt><dd>{run.engine} {run.engineVersion}</dd><dt>Isolation</dt><dd>{run.configuration.isolation}</dd><dt>Actors</dt><dd>{run.configuration.concurrency ?? 'legacy default'}</dd>
            <dt>Sample</dt><dd>{run.summary?.trials ?? run.configuration.trials} trial(s)</dd>
          </dl>
          {completed && run.summary && <div className="mt-3 grid grid-cols-2 gap-2">
            <div className={`rounded-lg p-2 ${violations ? 'bg-rose-500/10' : 'bg-emerald-500/10'}`}><div className="workbench-eyebrow">INVARIANT VIOLATIONS</div><div className="mt-1 text-xl font-bold tabular-nums">{violations}</div><span className="text-[10px] text-stone-400">across {run.summary.invariantChecks} checks</span></div>
            <div className="rounded-lg bg-sky-500/8 p-2"><div className="workbench-eyebrow">P95 ACTOR TIME</div><div className="mt-1 text-xl font-bold tabular-nums">{run.summary.p95Ms} ms</div><span className="text-[10px] text-stone-400">n={run.summary.trials} trials</span></div>
          </div>}
          {run.error && <p className="mt-3 text-sm text-rose-300">{run.error}</p>}
          {completed && run.summary && <div className="mt-3 space-y-1">
            {run.summary.invariants.map((invariant) => <div key={invariant.id} className="flex items-start gap-2 text-xs">
              {invariant.passed ? <CheckCircle2 size={14} className="mt-0.5 text-emerald-300" /> : <CircleAlert size={14} className="mt-0.5 text-rose-300" />}
              <span>{invariant.description}{invariant.failures.length ? ` · ${invariant.failures.join('; ')}` : ''}</span>
            </div>)}
          </div>}
        </div>}
      </div>

      <ExperimentBatchesPanel workspace={workspace} runMode={configuration.runMode} isDirty={isDirty} />

      {run && <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
        <section className="workbench-panel min-w-0" aria-labelledby="event-trace-heading">
          <div className="flex items-center justify-between border-b border-fg/8 px-4 py-3"><div><p className="workbench-eyebrow">ORDERED DATABASE TRACE</p><h3 id="event-trace-heading" className="font-semibold">Actor lanes / events</h3></div><span className="font-mono text-xs text-stone-500">{events.length} event(s)</span></div>
          <ol className="max-h-[440px] divide-y divide-fg/5 overflow-y-auto">
            {events.map((event) => <li key={event.sequence}>
              <button onClick={() => setSelected(event)} aria-current={selected?.sequence === event.sequence ? 'true' : undefined} className={`flex w-full items-start gap-3 p-3 text-left hover:bg-fg/5 ${selected?.sequence === event.sequence ? 'bg-sky-400/8' : ''}`}>
                <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${event.type.includes('aborted') || event.type.includes('rejected') ? 'bg-rose-300' : event.type.includes('wait') || event.type.includes('barrier') ? 'bg-amber-300' : event.type.includes('committed') ? 'bg-emerald-300' : 'bg-sky-300'}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2"><code className="text-xs text-stone-200">{event.type}</code><span className="text-[10px] text-stone-500">{event.actorId ?? `trial ${String(event.payload.trial ?? '')}`}</span><span className="ml-auto text-[10px] text-stone-500">{new Date(event.at).toLocaleTimeString()}</span></span>
                  <span className="mt-1 block text-[10px] text-stone-500">{sourceLabel[event.source]}</span>
                </span>
              </button>
            </li>)}
            {!events.length && <li className="p-5 text-sm text-stone-500">{running ? 'Waiting for the first database event…' : 'No trace events were recorded.'}</li>}
          </ol>
        </section>
        <section className="workbench-panel min-w-0" aria-labelledby="event-inspector-heading">
          <div className="border-b border-fg/8 px-4 py-3"><p className="workbench-eyebrow">CONTEXTUAL EVIDENCE</p><h3 id="event-inspector-heading" className="font-semibold">{selected?.type ?? 'Select a trace event'}</h3></div>
          {selected ? <div className="space-y-3 p-4">
            <Badge tone={selected.source === 'DBMS_OBSERVED' ? 'sky' : selected.source === 'DATASIM_DERIVED' ? 'amber' : 'violet'}>{sourceLabel[selected.source]}</Badge>
            <pre className="max-h-48 overflow-auto rounded-lg bg-black/25 p-3 text-[11px] text-stone-300">{JSON.stringify(selected.payload, null, 2)}</pre>
            {selected.sql && <div><p className="workbench-eyebrow">PARAMETERIZED SQL / COMMAND</p><pre className="mt-1 overflow-auto rounded-lg bg-black/25 p-3 text-[11px] text-sky-200">{selected.sql}</pre></div>}
            <div className="text-[11px] text-stone-500">Timestamp: {new Date(selected.at).toLocaleString()}</div>
          </div> : <div className="p-4 text-sm text-stone-500">Select any event to inspect its observed/modelled source, payload, and SQL.</div>}
        </section>
      </div>}
      {run?.summary && <details className="workbench-panel">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Final database state for each trial</summary>
        <div className="space-y-3 px-4 pb-4">{run.summary.outcomes.map((outcome) => <div key={outcome.trial}>
          <p className="workbench-eyebrow">TRIAL {outcome.trial} · {outcome.durationMs} ms</p>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-black/25 p-3 text-[11px] text-stone-300">{JSON.stringify(outcome.finalState, null, 2)}</pre>
        </div>)}</div>
      </details>}
    </section>
  );
}
