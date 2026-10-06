import { useEffect, useState } from 'react';
import { Ban, ChartNoAxesCombined, Play, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button } from '../ui';
import { api, type ErrorBody } from '../../lib/api';
import type { ExperimentBatch, RunConfiguration, Workspace } from '../../lib/workspaces';

const isolationOptions: RunConfiguration['isolation'][] = ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'];

function message(body: unknown, fallback: string): string {
  return (body as ErrorBody | undefined)?.message || fallback;
}

function activeStatus(status: ExperimentBatch['status']): boolean {
  return status === 'QUEUED' || status === 'RUNNING';
}

function tone(status: ExperimentBatch['status'] | NonNullable<ExperimentBatch['cells']>[number]['status']): 'green' | 'red' | 'amber' | 'stone' {
  if (status === 'COMPLETED') return 'green';
  if (status === 'QUEUED' || status === 'RUNNING') return 'amber';
  if (status === 'PARTIAL' || status === 'FAILED') return 'red';
  return 'stone';
}

export function ExperimentBatchesPanel({ workspace, runMode, isDirty }: {
  workspace: Workspace;
  runMode: RunConfiguration['runMode'];
  isDirty: boolean;
}) {
  const [searchParams] = useSearchParams();
  const requestedBatchId = searchParams.get('batch');
  const actorCount = workspace.definition.actors.length;
  const [concurrencies, setConcurrencies] = useState<number[]>(() => actorCount >= 2 ? [1, actorCount] : []);
  const [isolations, setIsolations] = useState<RunConfiguration['isolation'][]>(['READ COMMITTED']);
  const [trials, setTrials] = useState(3);
  const [seed, setSeed] = useState(1);
  const [timeoutMs, setTimeoutMs] = useState(15000);
  const [batch, setBatch] = useState<ExperimentBatch | null>(null);
  const [history, setHistory] = useState<ExperimentBatch[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadHistory() {
    const result = await api.get<ExperimentBatch[]>(`/batches?workspaceId=${encodeURIComponent(workspace.id)}`);
    if (!result.ok) throw new Error(message(result.body, 'Could not load experiment batch history.'));
    setHistory(result.body);
  }

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    async function poll(batchId: string) {
      try {
        const [batchResult, historyResult] = await Promise.all([
          api.get<ExperimentBatch>(`/batches/${batchId}`),
          api.get<ExperimentBatch[]>(`/batches?workspaceId=${encodeURIComponent(workspace.id)}`),
        ]);
        if (!live) return;
        if (!batchResult.ok) throw new Error(message(batchResult.body, 'Could not refresh experiment batch.'));
        if (!historyResult.ok) throw new Error(message(historyResult.body, 'Could not refresh experiment history.'));
        setBatch(batchResult.body);
        setHistory(historyResult.body);
        if (activeStatus(batchResult.body.status)) timer = window.setTimeout(() => void poll(batchId), 900);
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : 'Could not refresh experiment batch.');
      }
    }
    if (batch && activeStatus(batch.status)) timer = window.setTimeout(() => void poll(batch.id), 500);
    return () => { live = false; if (timer) window.clearTimeout(timer); };
  }, [batch?.id, batch?.status, workspace.id]);

  useEffect(() => {
    void loadHistory().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load experiment batch history.'));
  }, [workspace.id]);

  useEffect(() => {
    if (requestedBatchId) void openBatch(requestedBatchId);
  }, [requestedBatchId]);

  function toggleConcurrency(value: number) {
    setConcurrencies((current) => current.includes(value)
      ? current.filter((candidate) => candidate !== value)
      : [...current, value].sort((left, right) => left - right));
  }

  function toggleIsolation(value: RunConfiguration['isolation']) {
    setIsolations((current) => current.includes(value)
      ? current.filter((candidate) => candidate !== value)
      : isolationOptions.filter((candidate) => current.includes(candidate) || candidate === value));
  }

  async function startBatch() {
    setBusy(true); setError(''); setBatch(null);
    try {
      const result = await api.post<{ batchId?: string; status?: string; message?: string; problems?: { path: string; message: string }[] }>(
        `/workspaces/${workspace.id}/batches`,
        { runMode, concurrencies, isolationLevels: isolations, trials, seed, timeoutMs },
      );
      if (!result.ok) {
        const details = result.body.problems?.map((problem) => `${problem.path}: ${problem.message}`).join(' ');
        throw new Error([message(result.body, 'Could not start experiment batch.'), details].filter(Boolean).join(' '));
      }
      if (!result.body.batchId) throw new Error('The server accepted the batch without returning its ID.');
      const created = await api.get<ExperimentBatch>(`/batches/${result.body.batchId}`);
      if (!created.ok) throw new Error(message(created.body, 'The batch was created but could not be loaded.'));
      setBatch(created.body);
      await loadHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start experiment batch.');
    } finally { setBusy(false); }
  }

  async function openBatch(batchId: string) {
    setError('');
    const result = await api.get<ExperimentBatch>(`/batches/${batchId}`);
    if (!result.ok) setError(message(result.body, 'Could not load experiment batch.'));
    else setBatch(result.body);
  }

  async function cancelBatch() {
    if (!batch) return;
    const result = await api.post(`/batches/${batch.id}/cancel`, {});
    if (!result.ok) setError(message(result.body, 'Could not cancel experiment batch.'));
    else {
      const refreshed = await api.get<ExperimentBatch>(`/batches/${batch.id}`);
      if (refreshed.ok) setBatch(refreshed.body);
    }
  }

  const cellCount = concurrencies.length * isolations.length;
  const workload = concurrencies.reduce((total, concurrency) => total + concurrency, 0) * isolations.length * trials;

  return (
    <section className="workbench-panel space-y-4 p-4" aria-labelledby="batch-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="workbench-eyebrow"><ChartNoAxesCombined size={13} /> EXPERIMENT MATRIX</p><h3 id="batch-title" className="font-semibold">Concurrency and isolation sweep</h3>
          <p className="mt-1 max-w-2xl text-xs text-stone-400">Runs the selected actor prefixes against each InnoDB isolation level. This seed is recorded metadata; it does not control scheduling.</p>
          <p className="mt-1 font-mono text-[10px] text-stone-500">Mode: {runMode} · each child-run timeout is enforced independently.</p>
        </div>
        <Button size="sm" onClick={() => void loadHistory().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not refresh batch history.'))}><RefreshCw size={13} /> Refresh batches</Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
        <div className="space-y-3">
          <fieldset className="space-y-2" disabled={busy || activeStatus(batch?.status ?? 'FAILED')}>
            <legend className="workbench-control mb-2">Actor concurrency (configured lanes: {actorCount})</legend>
            <div className="flex flex-wrap gap-2">
              {workspace.definition.actors.map((actor, index) => {
                const value = index + 1;
                return <label key={actor.id} className="inline-flex items-center gap-2 rounded-md border border-fg/10 px-2.5 py-1.5 text-xs text-stone-300">
                  <input type="checkbox" checked={concurrencies.includes(value)} onChange={() => toggleConcurrency(value)} /> {value} · {actor.name}
                </label>;
              })}
            </div>
          </fieldset>
          <fieldset className="space-y-2" disabled={busy || activeStatus(batch?.status ?? 'FAILED')}>
            <legend className="workbench-control mb-2">InnoDB isolation dimensions</legend>
            <div className="flex flex-wrap gap-2">
              {isolationOptions.map((isolation) => <label key={isolation} className="inline-flex items-center gap-2 rounded-md border border-fg/10 px-2.5 py-1.5 text-xs text-stone-300">
                <input type="checkbox" checked={isolations.includes(isolation)} onChange={() => toggleIsolation(isolation)} /> {isolation}
              </label>)}
            </div>
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="workbench-control">Trials per cell (max 10)
              <input type="number" min={1} max={10} value={trials} onChange={(event) => setTrials(Math.max(1, Math.min(10, Number(event.target.value))))} className="workbench-input" />
            </label>
            <label className="workbench-control">Recorded seed
              <input type="number" min={0} max={2147483647} value={seed} onChange={(event) => setSeed(Math.max(0, Number(event.target.value)))} className="workbench-input" />
            </label>
            <label className="workbench-control">Child run timeout (ms)
              <input type="number" min={2000} max={30000} step={1000} value={timeoutMs} onChange={(event) => setTimeoutMs(Math.max(2000, Math.min(30000, Number(event.target.value))))} className="workbench-input" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="play" onClick={() => void startBatch()} disabled={busy || isDirty || cellCount < 2 || workload > 240 || actorCount < 2 || !isolations.length}>
              <Play size={14} /> {busy ? 'Queueing…' : isDirty ? 'Save before sweeping' : `Run ${cellCount} cells`}
            </Button>
            {batch && activeStatus(batch.status) && <Button variant="danger" onClick={() => void cancelBatch()}><Ban size={14} /> Cancel batch</Button>}
            <span className="text-[11px] text-stone-500">Budget: {workload}/240 actor-trials · max 12 cells</span>
          </div>
        </div>

        <aside className="rounded-lg border border-fg/8 bg-black/10 p-3" aria-label="Persisted experiment batch history">
          <p className="workbench-eyebrow">SAVED BATCHES</p>
          {!history.length ? <p className="mt-2 text-xs text-stone-500">No batch records for this workspace yet.</p> : <ul className="mt-2 space-y-1.5">
            {history.map((item) => <li key={item.id}>
              <button className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-fg/5" onClick={() => void openBatch(item.id)}>
                <span className="truncate font-mono text-stone-300">r{item.revision} · {item.id.slice(0, 8)}</span><Badge tone={tone(item.status)}>{item.status}</Badge>
              </button>
            </li>)}
          </ul>}
        </aside>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-400/25 bg-rose-500/5 p-3 text-sm text-rose-200">{error}</div>}
      {batch && <div className="space-y-3 border-t border-fg/8 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><Badge tone={tone(batch.status)}>{batch.status}</Badge><span className="ml-2 text-xs text-stone-400">{batch.finishedCells}/{batch.totalCells} cells finished · {batch.completedCells} completed</span></div>
          <span className="font-mono text-[10px] text-stone-500">r{batch.revision} · {batch.revisionHash.slice(0, 12)} · {batch.engine} {batch.engineVersion}</span>
        </div>
        <p className="text-xs text-stone-400">Metric: p95 of per-trial total concurrent actor execution duration (ms), nearest-rank aggregation within each cell; not a production latency/SLO. Trial counts and empty/failed values are kept explicit.</p>
        {batch.error && <p role="status" className="text-xs text-amber-200">{batch.error}</p>}
        <div className="overflow-x-auto">
          <table className="workbench-table w-full text-left text-xs">
            <caption className="sr-only">Persisted sweep configuration cells, metrics, trial counts and source run IDs</caption>
            <thead><tr><th>Actors</th><th>Isolation</th><th>Status</th><th>p95 actor time (ms)</th><th>Trials</th><th>Violations</th><th>Source run</th><th>Cell error</th></tr></thead>
            <tbody>{batch.cells?.map((cell) => <tr key={cell.index}>
              <td>{cell.concurrency}</td><td>{cell.isolation}</td><td><Badge tone={tone(cell.status)}>{cell.status}</Badge></td>
              <td>{cell.p95Ms ?? '—'}</td><td>{cell.trialsCompleted}/{batch.configuration.trials}</td><td>{cell.violations ?? '—'}</td>
              <td>{cell.runId ? <Link className="text-sky-300 underline" to={`/runs?run=${encodeURIComponent(cell.runId)}`}>{cell.runId.slice(0, 8)}</Link> : '—'}</td>
              <td className="max-w-64 truncate text-rose-200">{cell.error ?? '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>}
    </section>
  );
}
