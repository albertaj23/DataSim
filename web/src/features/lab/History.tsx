import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { ExperimentRun } from '../../lib/labApi';
import { formatMs, formatNumber, relativeTime, shortId } from '../../lib/format';
import { Button, EmptyState, Pill, ProvenanceTag, Select, Skeleton, Table, TBody, TD, TH, THead, TR, cn } from '../../ui';
import { aggregateRuns, aggregatesToCsv, aggregatesToMarkdown, downloadText, trialsToCsv } from './logic';
import { Notice, Panel, Segmented } from './widgets';

type ExpFilter = 'all' | ExperimentRun['experiment'];
type View = 'summary' | 'trials';

const MAX = 500;

export function History() {
  const [rows, setRows] = useState<ExperimentRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exp, setExp] = useState<ExpFilter>('all');
  const [strategy, setStrategy] = useState('all');
  const [view, setView] = useState<View>('summary');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await api.get<ExperimentRun[]>(`/lab/runs?limit=${MAX}`);
    setLoading(false);
    if (r.ok && Array.isArray(r.body)) setRows(r.body); else setError(errorMessage(r));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const strategies = useMemo(() => ['all', ...[...new Set((rows ?? []).map((r) => r.strategy))].sort()], [rows]);
  const filtered = useMemo(
    () => (rows ?? []).filter((r) => (exp === 'all' || r.experiment === exp) && (strategy === 'all' || r.strategy === strategy)),
    [rows, exp, strategy],
  );
  const aggs = useMemo(() => aggregateRuns(filtered), [filtered]);

  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <Panel
      title="Experiment history"
      subtitle={rows ? `${formatNumber(filtered.length)} of ${formatNumber(rows.length)} saved trials${rows.length >= MAX ? ` (newest ${MAX})` : ''} · table experiment_run` : 'Persisted runs from the experiment_run table'}
      actions={<ProvenanceTag kind="MEASURED" />}
      bodyClassName="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<ExpFilter> label="Experiment" value={exp} onChange={setExp} options={[{ value: 'all', label: 'All' }, { value: 'STREAM_LIMIT', label: 'Stream limit' }, { value: 'LOST_UPDATE', label: 'Lost update' }]} />
        <div className="w-44"><Select size="sm" aria-label="Strategy filter" value={strategy} onValueChange={setStrategy} mono options={strategies.map((s) => ({ value: s, label: s === 'all' ? 'All strategies' : s }))} /></div>
        <Segmented<View> label="View" value={view} onChange={setView} options={[{ value: 'summary', label: 'Per strategy' }, { value: 'trials', label: 'Every trial' }]} />
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" icon={<RefreshCw size={14} />} loading={loading} onClick={() => void load()}>Refresh</Button>
          <Button size="sm" icon={<Download size={14} />} disabled={filtered.length === 0}
            onClick={() => downloadText(`lab-${view === 'trials' ? 'trials' : 'summary'}-${stamp}.csv`, view === 'trials' ? trialsToCsv(filtered) : aggregatesToCsv(aggs), 'text/csv')}>CSV</Button>
          <Button size="sm" icon={<FileText size={14} />} disabled={filtered.length === 0}
            onClick={() => downloadText(`lab-summary-${stamp}.md`, aggregatesToMarkdown(aggs), 'text/markdown')}>Markdown</Button>
        </div>
      </div>

      {error && <Notice>{error}</Notice>}

      {rows === null && !error && (
        <div className="flex flex-col gap-1.5" aria-busy="true"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
      )}

      {rows && rows.length === 0 && (
        <EmptyState title="No experiment runs yet" description="Run a strategy benchmark in the first tab. Every trial is saved here." />
      )}

      {rows && rows.length > 0 && filtered.length === 0 && (
        <div className="grid min-h-24 place-items-center text-sm text-muted">No runs match these filters.</div>
      )}

      {filtered.length > 0 && (
        <div className="max-h-[560px] overflow-auto rounded-lg border border-line [&>div]:overflow-visible [&>div]:border-0">
          {view === 'summary' ? <SummaryTable aggs={aggs} /> : <TrialsTable rows={filtered} />}
        </div>
      )}
    </Panel>
  );
}

function SummaryTable({ aggs }: { aggs: ReturnType<typeof aggregateRuns> }) {
  return (
    <Table aria-label="Experiment runs per strategy">
      <THead>
        <tr>
          <TH>When</TH><TH>Experiment</TH><TH>Strategy</TH><TH>Isolation</TH><TH align="right">Trials</TH>
          <TH>Params</TH><TH align="right">Violations</TH><TH align="right">Retries</TH><TH align="right">Deadlocks</TH><TH align="right">p50</TH><TH align="right">p95</TH><TH align="right">Throughput</TH><TH>Batch</TH>
        </tr>
      </THead>
      <TBody>
        {aggs.map((a) => (
          <TR key={a.key}>
            <TD className="whitespace-nowrap text-xs text-muted" title={a.createdAt}>{relativeTime(a.createdAt)}</TD>
            <TD><Pill>{a.experiment === 'STREAM_LIMIT' ? 'stream limit' : 'lost update'}</Pill></TD>
            <TD mono className="font-medium">{a.name}</TD>
            <TD className="whitespace-nowrap text-xs text-muted">{a.isolation}</TD>
            <TD align="right" mono>{a.trials}</TD>
            <TD mono className="whitespace-nowrap text-xs text-muted">
              {a.experiment === 'STREAM_LIMIT' ? `${a.concurrency}c · ${a.accounts}a · ${a.maxStreams}s · ${a.raceDelayMs}ms` : `${a.concurrency}w · ${a.raceDelayMs}ms`}
            </TD>
            <TD align="right" mono className={cn(a.violations > 0 ? 'font-medium text-bad' : 'text-ok')}>{formatNumber(a.violations)}</TD>
            <TD align="right" mono>{formatNumber(a.retries, Number.isInteger(a.retries) ? 0 : 2)}</TD>
            <TD align="right" mono>{formatNumber(a.deadlocks, Number.isInteger(a.deadlocks) ? 0 : 2)}</TD>
            <TD align="right" mono>{formatMs(a.p50)}</TD>
            <TD align="right" mono>{formatMs(a.p95)}</TD>
            <TD align="right" mono>{formatNumber(a.rps, 1)}/s</TD>
            <TD mono className="text-xs text-faint">{shortId(a.batchId)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function TrialsTable({ rows }: { rows: ExperimentRun[] }) {
  return (
    <Table aria-label="Experiment trials">
      <THead>
        <tr>
          <TH align="right">Run</TH><TH>When</TH><TH>Strategy</TH><TH align="right">Trial</TH><TH align="right">Granted</TH><TH align="right">Rejected</TH>
          <TH align="right">Violations</TH><TH align="right">Retries</TH><TH align="right">Deadlocks</TH><TH align="right">Errors</TH><TH align="right">p50</TH><TH align="right">p95</TH><TH>Source</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.runId}>
            <TD align="right" mono className="text-faint">{r.runId}</TD>
            <TD className="whitespace-nowrap text-xs text-muted" title={r.createdAt}>{relativeTime(r.createdAt)}</TD>
            <TD mono className="font-medium">{r.strategy}</TD>
            <TD align="right" mono>{r.trial}</TD>
            <TD align="right" mono>{r.granted}</TD>
            <TD align="right" mono>{r.rejected}</TD>
            <TD align="right" mono className={cn(r.violations > 0 ? 'font-medium text-bad' : 'text-ok')}>{r.violations}</TD>
            <TD align="right" mono>{r.retries}</TD>
            <TD align="right" mono>{r.deadlocks}</TD>
            <TD align="right" mono className={cn(r.errors > 0 && 'text-bad')}>{r.errors}</TD>
            <TD align="right" mono>{formatMs(r.p50Ms)}</TD>
            <TD align="right" mono>{formatMs(r.p95Ms)}</TD>
            <TD className="text-xs text-muted">{r.source}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
