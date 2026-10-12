import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, FileText, Play, Square } from 'lucide-react';
import { api, type ApiResult } from '../../lib/api';
import { uuid } from '../../lib/uuid';
import { useHealth } from '../../lib/useHealth';
import {
  LOST_UPDATE_VARIANTS, STRATEGY_NAMES,
  type Aggregate, type ExperimentResponse, type ExperimentRun, type LabErrorBody, type LabIsolation, type LostUpdateAggregate,
  type LostUpdateResponse, type LostUpdateVariant, type RaceMode, type StrategyName,
} from '../../lib/labApi';
import { Button, Field, NumberField, Pill, ProvenanceTag, Select, cn } from '../../ui';
import {
  LOST_UPDATE_INFO, STRATEGY_INFO, aggregateRuns, aggregatesToMarkdown, downloadText, labErrorMessage, lostRow, planStrategies,
  progressPct, streamRow, trialsToCsv, validateStreamParams, type ResultRow,
} from './logic';
import { ResultsChart, ResultsTable } from './ResultsView';
import { Notice, Panel, ProgressBar, Segmented, ToggleChip } from './widgets';

// ---------------------------------------------------------------- series runner

interface Progress { name: string; done: number; total: number; startedAt: number }

/**
 * Runs one request per item, sequentially, collecting results as they arrive. The server runs all trials of
 * one item inside a single request, so progress advances per item (strategy), not per trial.
 * 409 (lab busy), 400 (bad params) and network errors stop the series; other errors are recorded and the series continues.
 */
function useSeries<R, B>(setBusy: (b: boolean) => void) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState<R[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [batchRuns, setBatchRuns] = useState<ExperimentRun[]>([]);
  const stopRef = useRef(false);
  const startedAt = progress?.startedAt;

  useEffect(() => {
    if (startedAt == null) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [startedAt]);

  const start = useCallback(async (items: string[], batchId: string, call: (item: string) => Promise<ApiResult<B & LabErrorBody>>, pick: (body: B) => R) => {
    stopRef.current = false;
    setResults([]); setFailures([]); setBatchRuns([]); setBusy(true);
    const t0 = Date.now();
    const rows: R[] = [];
    const fails: string[] = [];
    for (let i = 0; i < items.length; i++) {
      if (stopRef.current) { fails.push(`Stopped before ${items[i]}.`); break; }
      setProgress({ name: items[i]!, done: i, total: items.length, startedAt: t0 });
      const r = await call(items[i]!);
      if (!r.ok) {
        fails.push(`${items[i]}: ${labErrorMessage({ status: r.status, code: r.body.code, message: r.body.message }, items[i])}`);
        if (r.status === 409 || r.status === 400 || r.status === 0) break;
        continue;
      }
      rows.push(pick(r.body as B));
      setResults([...rows]);
    }
    setFailures(fails);
    setProgress(null);
    const runs = await api.get<ExperimentRun[]>(`/lab/runs?batchId=${batchId}&limit=1000`);
    if (runs.ok && Array.isArray(runs.body)) setBatchRuns(runs.body);
    setBusy(false);
  }, [setBusy]);

  return { progress, elapsed, results, failures, batchRuns, start, stop: () => { stopRef.current = true; } };
}

// ---------------------------------------------------------------- shared pieces

function RunBar({ progress, elapsed, onRun, onStop, canRun, batchRuns, exportName, runLabel }: {
  progress: Progress | null; elapsed: number; onRun: () => void; onStop: () => void; canRun: boolean;
  batchRuns: ExperimentRun[]; exportName: string; runLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {progress ? (
          <Button variant="secondary" icon={<Square size={16} />} onClick={onStop}>Stop after {progress.name}</Button>
        ) : (
          <Button variant="primary" icon={<Play size={16} />} onClick={onRun} disabled={!canRun}>{runLabel}</Button>
        )}
        {progress && (
          <span className="font-mono text-xs text-muted tnum" aria-live="polite">
            Running {progress.name} · {progress.done + 1} of {progress.total} · {elapsed} s
          </span>
        )}
        {!progress && batchRuns.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-faint">{batchRuns.length} trials saved</span>
            <Button size="sm" icon={<Download size={14} />} onClick={() => downloadText(`${exportName}.csv`, trialsToCsv(batchRuns), 'text/csv')}>CSV</Button>
            <Button size="sm" icon={<FileText size={14} />} onClick={() => downloadText(`${exportName}.md`, aggregatesToMarkdown(aggregateRuns(batchRuns), `Concurrency Lab: ${exportName}`), 'text/markdown')}>Markdown</Button>
          </div>
        )}
      </div>
      {progress && <ProgressBar pct={progressPct(progress.done, progress.total)} label="Experiment progress" />}
    </div>
  );
}

function Explanations({ items, rows }: {
  items: { name: string; theory: string; text: string; expect: 'violations' | 'safe' | 'rare' }[]; rows: ResultRow[];
}) {
  return (
    <Panel title="What each one does" subtitle="Theory in one paragraph, with the observed outcome once run">
      <ul className="grid gap-2.5 md:grid-cols-2">
        {items.map((s) => {
          const r = rows.find((x) => x.name === s.name);
          return (
            <li key={s.name} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-medium text-fg">{s.name}</span>
                <span className="flex items-center gap-1.5">
                  <Pill>{s.theory}</Pill>
                  {r && <Pill tone={r.violations > 0 ? 'red' : 'green'} mono>{r.violations > 0 ? `${r.violations} violations` : '0 violations'}</Pill>}
                </span>
              </div>
              <p className="text-xs text-muted">{s.text}</p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function ResultsPlaceholder({ children }: { children: ReactNode }) {
  return <div className="grid min-h-28 place-items-center rounded-lg border border-dashed border-line px-4 text-center text-sm text-muted">{children}</div>;
}

const ISOLATIONS: { value: 'default' | LabIsolation; label: string }[] = [
  { value: 'default', label: 'Strategy default' },
  { value: 'READ COMMITTED', label: 'READ COMMITTED' },
  { value: 'REPEATABLE READ', label: 'REPEATABLE READ' },
  { value: 'SERIALIZABLE', label: 'SERIALIZABLE' },
];
const numOptions = (xs: number[], suffix = '') => xs.map((n) => ({ value: String(n), label: `${n}${suffix}` }));

// ---------------------------------------------------------------- stream limit

function StreamLimitLab({ busy, setBusy }: { busy: boolean; setBusy: (b: boolean) => void }) {
  const { health } = useHealth();
  const redisUp = health ? health.redis.ok : true;
  const [strategies, setStrategies] = useState<StrategyName[]>([...STRATEGY_NAMES]);
  const [isolation, setIsolation] = useState<'default' | LabIsolation>('default');
  const [concurrency, setConcurrency] = useState(30);
  const [accounts, setAccounts] = useState(1);
  const [maxStreams, setMaxStreams] = useState(1);
  const [raceDelayMs, setRaceDelayMs] = useState(20);
  const [mode, setMode] = useState<RaceMode>('NORMAL');
  const [trials, setTrials] = useState(10);
  const [formError, setFormError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [batchId, setBatchId] = useState('');
  const series = useSeries<Aggregate, ExperimentResponse>(setBusy);

  const toggle = (s: StrategyName, on: boolean) => setStrategies((xs) => (on ? STRATEGY_NAMES.filter((n) => n === s || xs.includes(n)) : xs.filter((x) => x !== s)));

  const run = () => {
    const bad = validateStreamParams({ strategies, concurrency, accounts, maxStreams });
    setFormError(bad);
    if (bad) return;
    const plan = planStrategies(strategies, maxStreams, redisUp);
    setSkipped(plan.skipped.map((s) => `${s.name} skipped. ${s.reason}`));
    if (plan.run.length === 0) { setFormError('Nothing to run: every selected strategy was skipped.'); return; }
    const batch = uuid();
    setBatchId(batch);
    void series.start(plan.run, batch, (s) => api.post<ExperimentResponse & LabErrorBody>('/lab/experiments', {
      strategy: s, isolation: isolation === 'default' ? undefined : isolation, concurrency, accounts, maxStreams, raceDelayMs, mode, trials, batchId: batch,
    }), (b) => b.aggregate);
  };

  const rows = series.results.map(streamRow);

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Stream limit experiment" subtitle="N clients claim the same account at once, N trials per strategy; the invariant counts active allocations above the limit">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted" id="strategy-label">Strategies</span>
            <div role="group" aria-labelledby="strategy-label" className="flex flex-wrap gap-1.5">
              {STRATEGY_NAMES.map((s) => (
                <ToggleChip
                  key={s}
                  pressed={strategies.includes(s)}
                  onPressedChange={(v) => toggle(s, v)}
                  disabled={s === 'REDIS_LEASE' && !redisUp}
                  title={s === 'REDIS_LEASE' && !redisUp ? 'Redis is unreachable' : STRATEGY_INFO[s].theory}
                >
                  {s}
                </ToggleChip>
              ))}
            </div>
            {!redisUp && <Notice tone="warn">Redis is unreachable, so REDIS_LEASE is disabled. Start it with npm run db:up.</Notice>}
            {maxStreams > 1 && strategies.includes('CONSTRAINT') && <Notice tone="warn">CONSTRAINT only supports max streams = 1 and will be skipped.</Notice>}
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-3 md:grid-cols-4">
            <Field label="Concurrency" hint="simultaneous claims, 2 to 100">
              {(id) => <NumberField id={id} value={concurrency} min={2} max={100} onCommit={setConcurrency} unit="clients" />}
            </Field>
            <Field label="Accounts" hint="1 = maximum contention">
              {(id) => <Select id={id} value={String(accounts)} onValueChange={(v) => setAccounts(Number(v))} options={numOptions([1, 2, 4, 8, 16])} />}
            </Field>
            <Field label="Max streams" hint="allocations allowed per account">
              {(id) => <Select id={id} value={String(maxStreams)} onValueChange={(v) => setMaxStreams(Number(v))} options={numOptions([1, 2, 3])} />}
            </Field>
            <Field label="Race delay" hint="emulated sleep between check and write">
              {(id) => <Select id={id} value={String(raceDelayMs)} onValueChange={(v) => setRaceDelayMs(Number(v))} options={numOptions([0, 5, 20, 50], ' ms')} />}
            </Field>
            <Field label="Mode" hint="TAKEOVER preempts the oldest allocation">
              {(id) => <Select id={id} value={mode} onValueChange={(v) => setMode(v as RaceMode)} options={[{ value: 'NORMAL', label: 'NORMAL' }, { value: 'TAKEOVER', label: 'TAKEOVER' }]} />}
            </Field>
            <Field label="Isolation" hint="overrides the strategy default">
              {(id) => <Select id={id} value={isolation} onValueChange={(v) => setIsolation(v as 'default' | LabIsolation)} options={ISOLATIONS} />}
            </Field>
            <Field label="Trials" hint="per strategy, 1 to 50">
              {(id) => <NumberField id={id} value={trials} min={1} max={50} onCommit={setTrials} />}
            </Field>
          </div>

          {formError && <Notice>{formError}</Notice>}
          <RunBar
            progress={series.progress} elapsed={series.elapsed} onRun={run} onStop={series.stop}
            canRun={!busy && strategies.length > 0} batchRuns={series.batchRuns} exportName={`stream-limit-${batchId.slice(0, 8)}`}
            runLabel={`Run ${strategies.length} ${strategies.length === 1 ? 'strategy' : 'strategies'}`}
          />
          {skipped.map((s) => <Notice key={s} tone="warn">{s}</Notice>)}
          {series.failures.map((f) => <Notice key={f}>{f}</Notice>)}
        </div>
      </Panel>

      <Panel
        title="Results"
        subtitle="Violations, retries, deadlocks and latency are measured on MySQL. Throughput is claims per second for one burst."
        actions={<><ProvenanceTag kind="MEASURED" /><ProvenanceTag kind="EMULATED" /></>}
      >
        {rows.length === 0
          ? <ResultsPlaceholder>{series.progress ? 'Waiting for the first strategy to finish.' : 'Run the experiment to see violations, retries, deadlocks and latency per strategy.'}</ResultsPlaceholder>
          : (
            <div className="flex flex-col gap-4">
              <ResultsTable rows={rows} kind="stream" />
              <ResultsChart rows={rows} />
            </div>
          )}
      </Panel>

      <Explanations items={STRATEGY_NAMES.map((s) => STRATEGY_INFO[s])} rows={rows} />
    </div>
  );
}

// ---------------------------------------------------------------- lost update

function LostUpdateLab({ busy, setBusy }: { busy: boolean; setBusy: (b: boolean) => void }) {
  const [variants, setVariants] = useState<LostUpdateVariant[]>([...LOST_UPDATE_VARIANTS]);
  const [increments, setIncrements] = useState(50);
  const [raceDelayMs, setRaceDelayMs] = useState(20);
  const [trials, setTrials] = useState(5);
  const [batchId, setBatchId] = useState('');
  const series = useSeries<LostUpdateAggregate, LostUpdateResponse>(setBusy);

  const toggle = (v: LostUpdateVariant, on: boolean) => setVariants((xs) => (on ? LOST_UPDATE_VARIANTS.filter((n) => n === v || xs.includes(n)) : xs.filter((x) => x !== v)));

  const run = () => {
    const batch = uuid();
    setBatchId(batch);
    void series.start(variants, batch, (v) => api.post<LostUpdateResponse & LabErrorBody>('/lab/lost-update', {
      variant: v, increments, raceDelayMs, trials, batchId: batch,
    }), (b) => b.aggregate);
  };

  const rows = series.results.map(lostRow);

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Lost update experiment" subtitle="N workers each add 1 to the same counter row; the counter should end at N">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted" id="variant-label">Variants</span>
            <div role="group" aria-labelledby="variant-label" className="flex flex-wrap gap-1.5">
              {LOST_UPDATE_VARIANTS.map((v) => (
                <ToggleChip key={v} pressed={variants.includes(v)} onPressedChange={(on) => toggle(v, on)} title={LOST_UPDATE_INFO[v].theory}>{v}</ToggleChip>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3 md:grid-cols-4">
            <Field label="Increments" hint="concurrent workers, 2 to 100">
              {(id) => <NumberField id={id} value={increments} min={2} max={100} onCommit={setIncrements} unit="workers" />}
            </Field>
            <Field label="Race delay" hint="emulated sleep between read and write">
              {(id) => <Select id={id} value={String(raceDelayMs)} onValueChange={(v) => setRaceDelayMs(Number(v))} options={numOptions([0, 5, 20, 50], ' ms')} />}
            </Field>
            <Field label="Trials" hint="per variant, 1 to 20">
              {(id) => <NumberField id={id} value={trials} min={1} max={20} onCommit={setTrials} />}
            </Field>
          </div>
          <RunBar
            progress={series.progress} elapsed={series.elapsed} onRun={run} onStop={series.stop}
            canRun={!busy && variants.length > 0} batchRuns={series.batchRuns} exportName={`lost-update-${batchId.slice(0, 8)}`}
            runLabel={`Run ${variants.length} ${variants.length === 1 ? 'variant' : 'variants'}`}
          />
          {series.failures.map((f) => <Notice key={f}>{f}</Notice>)}
        </div>
      </Panel>

      <Panel
        title="Results"
        subtitle="Lost updates = increments that reported success but are missing from the final counter."
        actions={<><ProvenanceTag kind="MEASURED" /><ProvenanceTag kind="EMULATED" /></>}
      >
        {rows.length === 0
          ? <ResultsPlaceholder>{series.progress ? 'Waiting for the first variant to finish.' : 'Run the experiment to see lost updates, retries and latency per variant.'}</ResultsPlaceholder>
          : (
            <div className="flex flex-col gap-4">
              <ResultsTable rows={rows} kind="lost" />
              <ResultsChart rows={rows} metrics={[{ value: 'violations', label: 'Lost updates', unit: '' }, { value: 'p95', label: 'p95', unit: ' ms' }, { value: 'retries', label: 'Retries', unit: '' }]} />
            </div>
          )}
      </Panel>

      <Explanations items={LOST_UPDATE_VARIANTS.map((v) => LOST_UPDATE_INFO[v])} rows={rows} />
    </div>
  );
}

// ---------------------------------------------------------------- tab

export function StrategyBenchmark() {
  const [kind, setKind] = useState<'stream' | 'lost'>('stream');
  // One experiment at a time: the server holds a named lock, so the second form is disabled while the first runs.
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Segmented label="Experiment" value={kind} onChange={setKind} options={[{ value: 'stream', label: 'Stream limit' }, { value: 'lost', label: 'Lost update' }]} />
        <span className={cn('text-xs text-faint')}>One experiment runs at a time.</span>
      </div>
      {/* Both stay mounted so results survive switching. */}
      <div hidden={kind !== 'stream'}><StreamLimitLab busy={busy} setBusy={setBusy} /></div>
      <div hidden={kind !== 'lost'}><LostUpdateLab busy={busy} setBusy={setBusy} /></div>
    </div>
  );
}
