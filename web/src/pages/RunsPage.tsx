import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ChartNoAxesCombined, Database, GitCompareArrows, History, Radio, Rows3 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card } from '../components/ui';
import { api, type ErrorBody } from '../lib/api';
import { usePageMeta } from '../lib/shell';
import type { ExperimentBatch, RunEvent, RunSummary } from '../lib/workspaces';
import NerdsPage from './NerdsPage';

function message(body: unknown): string {
  return (body as ErrorBody | undefined)?.message || 'Could not load run history.';
}

function runTone(run: RunSummary): 'green' | 'red' | 'amber' | 'stone' {
  if (run.status === 'QUEUED' || run.status === 'RUNNING') return 'amber';
  if (run.status !== 'COMPLETED') return 'red';
  return (run.summary?.violations ?? 0) > 0 ? 'red' : 'green';
}

function batchTone(batch: ExperimentBatch): 'green' | 'red' | 'amber' | 'stone' {
  if (batch.status === 'COMPLETED') return 'green';
  if (batch.status === 'QUEUED' || batch.status === 'RUNNING') return 'amber';
  if (batch.status === 'PARTIAL' || batch.status === 'FAILED') return 'red';
  return 'stone';
}

export default function RunsPage() {
  const [params, setParams] = useSearchParams();
  const legacyTab = params.get('tab');
  if (legacyTab) return <NerdsPage />;
  return <RunHistory onOpenLegacy={() => setParams({ tab: 'runs' })} />;
}

function RunHistory({ onOpenLegacy }: { onOpenLegacy: () => void }) {
  usePageMeta({ title: 'Runs & evidence', chapter: 'Pinned executions' });
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [batches, setBatches] = useState<ExperimentBatch[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState('');
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [params] = useSearchParams();
  const requestedRunId = params.get('run');

  async function refresh() {
    setLoading(true); setError('');
    try {
      const [runsResult, batchesResult] = await Promise.all([
        api.get<RunSummary[]>('/runs'),
        api.get<ExperimentBatch[]>('/batches'),
      ]);
      if (!runsResult.ok) throw new Error(message(runsResult.body));
      setRuns(runsResult.body);
      if (!batchesResult.ok) throw new Error(message(batchesResult.body));
      setBatches(batchesResult.body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load run history.');
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const runId = requestedRunId;
    if (!runId) return;
    let live = true;
    async function openRequestedRun(id: string) {
      const [runResult, eventResult] = await Promise.all([
        api.get<RunSummary>(`/runs/${id}`),
        api.get<RunEvent[]>(`/runs/${id}/events`),
      ]);
      if (!live) return;
      if (!runResult.ok) { setError(message(runResult.body)); return; }
      if (!eventResult.ok) { setError(message(eventResult.body)); return; }
      setRuns((current) => current.some((run) => run.id === id) ? current : [runResult.body, ...current]);
      setExpandedId(id);
      setEvents(eventResult.body);
    }
    void openRequestedRun(runId).catch((caught: unknown) => {
      if (live) setError(caught instanceof Error ? caught.message : 'Could not load the selected run.');
    });
    return () => { live = false; };
  }, [requestedRunId]);

  const selected = useMemo(() => selectedIds.map((id) => runs.find((run) => run.id === id)).filter((run): run is RunSummary => Boolean(run)), [selectedIds, runs]);
  const comparable = selected.length === 2
    && selected[0]!.workspaceId === selected[1]!.workspaceId
    && selected[0]!.revisionHash === selected[1]!.revisionHash
    && selected[0]!.runMode === selected[1]!.runMode
    && selected[0]!.engine === selected[1]!.engine
    && selected[0]!.engineVersion === selected[1]!.engineVersion
    && selected[0]!.configuration.concurrency === selected[1]!.configuration.concurrency;

  async function toggleCompare(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current.slice(-1), id]);
  }

  async function showEvents(id: string) {
    if (expandedId === id) { setExpandedId(''); return; }
    setExpandedId(id);
    const result = await api.get<RunEvent[]>(`/runs/${id}/events`);
    if (!result.ok) setError(message(result.body));
    else setEvents(result.body);
  }

  return (
    <div className="workbench-page space-y-6">
      <header className="workbench-header">
        <div><p className="workbench-eyebrow"><History size={14} /> RUN HISTORY / EVIDENCE</p><h1>Execution record</h1><p className="workbench-lede">Every generic run points to an immutable workspace revision and labels database observations separately from derived checks.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void refresh()}>Refresh</Button>
          <Button onClick={onOpenLegacy}><Rows3 size={15} /> Legacy runs & evidence</Button>
          <Link to="/workspaces" className="workbench-action">Open workspaces <ArrowUpRight size={14} /></Link>
        </div>
      </header>
      {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
      {selected.length === 2 && <section className="workbench-panel space-y-4 p-4" aria-labelledby="compare-title">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="workbench-eyebrow"><GitCompareArrows size={13} /> COMPARISON</p><h2 id="compare-title" className="font-semibold">Selected run comparison</h2></div>
          <button className="text-xs text-stone-400 underline" onClick={() => setSelectedIds([])}>Clear selection</button>
        </div>
        {!comparable ? <p role="status" className="text-sm text-amber-200">These runs use different workspace revisions and are not directly comparable. Select two runs pinned to the same workspace revision.</p> : <>
          <div className="grid gap-3 md:grid-cols-2">{selected.map((run) => <div key={run.id} className="rounded-lg border border-fg/8 p-3">
            <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">r{run.revision} · {run.configuration.isolation}</span><Badge tone={runTone(run)}>{run.status}</Badge></div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-stone-400">
              <span>Mode: {run.runMode}</span><span>Trials: {run.summary?.trials ?? run.configuration.trials}</span>
              <span>Violations: {run.summary?.violations ?? '—'}</span><span>p95: {run.summary?.p95Ms == null ? '—' : `${run.summary.p95Ms} ms`}</span>
            </div>
          </div>)}</div>
          {selected.every((run) => run.summary) && <div className="grid gap-4 md:grid-cols-2">
            {(['p95Ms', 'violations'] as const).map((metric) => {
              const comparisons = selected.map((run) => ({
                run,
                value: metric === 'p95Ms' ? run.summary!.p95Ms : run.summary!.violations,
              }));
              const maximum = Math.max(1, ...comparisons.map(({ value }) => value ?? 0));
              const label = metric === 'p95Ms' ? 'p95 actor latency' : 'Invariant violations';
              const unit = metric === 'p95Ms' ? 'ms' : 'violations';
              return <figure key={metric} className="rounded-lg border border-fg/8 p-3">
                <figcaption className="mb-3 text-sm font-medium">{label} <span className="text-xs text-stone-500">({unit}; one value per run)</span></figcaption>
                <div role="img" aria-label={`${label} comparison: ${comparisons.map(({ run, value }) => `${run.configuration.isolation}, ${value === null ? 'not recorded' : `${value} ${unit}`}, n=${run.summary?.trials}`).join('; ')}`} className="space-y-3">
                  {comparisons.map(({ run, value }) => <div key={run.id}>
                    <div className="mb-1 flex justify-between gap-2 text-xs"><span className="truncate">{run.configuration.isolation}</span><span>{value === null ? 'not recorded' : `${value} ${unit}`} · n={run.summary?.trials}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-fg/10"><div className={`h-full rounded-full ${metric === 'violations' && value ? 'bg-rose-400' : 'bg-sky-300'}`} style={{ width: `${value === null ? 0 : Math.max(value ? 4 : 0, value / maximum * 100)}%` }} /></div>
                  </div>)}
                </div>
                <table className="sr-only"><caption>{label} comparison data</caption><thead><tr><th>Isolation</th><th>Value ({unit})</th><th>Sample count</th></tr></thead><tbody>{comparisons.map(({ run, value }) => <tr key={run.id}><td>{run.configuration.isolation}</td><td>{value ?? 'not recorded'}</td><td>{run.summary?.trials}</td></tr>)}</tbody></table>
              </figure>;
            })}
          </div>}
          <p className="text-[11px] text-stone-500">Run mode: {selected[0]!.runMode}; actors: {selected[0]!.configuration.concurrency ?? 'legacy default'}. Comparisons require the same revision, engine/version, mode, and actor count. Latency is total actor execution time per trial, not a production service SLO. Failed runs may retain completed-trial summaries; missing metrics remain unavailable.</p>
        </>}
      </section>}

      {batches.length > 0 && <section className="space-y-3" aria-labelledby="batch-history-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="workbench-eyebrow"><ChartNoAxesCombined size={13} /> CONCURRENCY / ISOLATION MATRICES</p><h2 id="batch-history-title" className="text-xl font-semibold">Experiment batches</h2></div>
          <span className="text-xs text-stone-500">{batches.length} recent batch(es)</span>
        </div>
        <div className="space-y-2">{batches.map((batch) => <article key={batch.id} className="workbench-panel flex flex-wrap items-center gap-3 p-3">
          <Badge tone={batchTone(batch)}>{batch.status}</Badge>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{batch.workspaceName} · r{batch.revision}</p>
            <p className="mt-1 font-mono text-[10px] text-stone-500">{batch.configuration.concurrencies.join(' / ')} actors · {batch.configuration.isolationLevels.join(', ')} · {batch.configuration.runMode} · {batch.engine} {batch.engineVersion}</p>
          </div>
          <span className="text-xs tabular-nums text-stone-400">{batch.finishedCells}/{batch.totalCells} finished · {batch.completedCells} completed · {batch.configuration.trials} trials/cell</span>
          <Link to={`/workspaces/${batch.workspaceId}?section=run&batch=${encodeURIComponent(batch.id)}`} className="workbench-action">Open batch evidence <ArrowUpRight size={13} /></Link>
        </article>)}</div>
      </section>}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3"><div><p className="workbench-eyebrow">LOCAL / MYSQL INNODB</p><h2 className="text-xl font-semibold">Saved runs</h2></div><span className="text-xs text-stone-500">{runs.length} run(s)</span></div>
        {loading ? <div className="workbench-empty">Loading run records…</div> : runs.length === 0 ? <div className="workbench-empty"><ChartNoAxesCombined size={30} /><h3>No saved runs yet</h3><p>Open a workspace, validate its scenario, then run it against MySQL.</p><Link to="/workspaces" className="workbench-action mt-3">Choose a workspace →</Link></div> :
          <div className="space-y-3">{runs.map((run) => <Card key={run.id} className="workbench-card" padded={false}>
            <div className="grid gap-3 p-4 lg:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={runTone(run)}>{run.status}</Badge><Badge tone="sky">{run.runMode.replaceAll('_', ' ')}</Badge><span className="font-mono text-xs text-stone-400">r{run.revision} · {run.revisionHash.slice(0, 12)}</span></div>
                <h3 className="mt-2 truncate font-semibold">{run.workspaceId}</h3>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                  <span className="inline-flex items-center gap-1"><Database size={12} /> {run.engine} {run.engineVersion}</span>
                  <span>{run.configuration.isolation}</span><span>{run.configuration.concurrency ?? 'legacy actor count'} actors</span><span>seed {run.seed}</span>
                  <span>{run.summary?.trials ?? run.configuration.trials} trial(s)</span>
                  <span>{new Date(run.createdAt).toLocaleString()}</span>
                </p>
                {run.summary && <p className="mt-2 text-sm text-stone-300">{run.summary.violations} invariant violation(s) across {run.summary.invariantChecks} checks · p95 {run.summary.p95Ms == null ? 'not recorded' : `${run.summary.p95Ms} ms`}{run.summary.partial ? ` · partial summary (${run.summary.trials} completed trial(s))` : ''}</p>}
                {run.error && <p className="mt-2 text-sm text-rose-300">{run.error}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-stone-400"><input type="checkbox" checked={selectedIds.includes(run.id)} onChange={() => void toggleCompare(run.id)} aria-label={`Compare run ${run.id}`} /> Compare</label>
                <Button size="sm" onClick={() => void showEvents(run.id)} aria-expanded={expandedId === run.id}><Radio size={13} /> {expandedId === run.id ? 'Hide trace' : 'Trace'}</Button>
                <Link to={`/workspaces/${run.workspaceId}`} className="workbench-action">Workspace →</Link>
              </div>
            </div>
            {expandedId === run.id && <div className="border-t border-fg/8 px-4 py-3">
              <p className="workbench-eyebrow mb-2">EVENT TRACE · OBSERVATIONS AND DERIVED METRICS ARE LABELLED</p>
              <ol className="max-h-80 space-y-1 overflow-y-auto">{events.map((event) => <li key={event.sequence} className="grid gap-1 rounded-md bg-black/10 px-2 py-1.5 text-xs sm:grid-cols-[130px_1fr_auto]">
                <span className="font-mono text-sky-200">{event.type}</span><span className="break-all text-stone-300">{event.actorId ?? JSON.stringify(event.payload)}</span><Badge tone={event.source === 'DBMS_OBSERVED' ? 'sky' : 'amber'}>{event.source}</Badge>
                {event.sql && <code className="col-span-full break-all text-[10px] text-stone-500">{event.sql}</code>}
              </li>)}</ol>
              {!events.length && <p className="text-xs text-stone-500">No events recorded.</p>}
            </div>}
          </Card>)}</div>}
      </section>
    </div>
  );
}
