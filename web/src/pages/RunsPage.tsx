import { Activity, GitCompare, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { isTerminal, type ProjectSummary, type RunKind, type RunStatus, type RunSummary } from '@datasim/shared';
import { MAX_COMPARE, compareBlockReason, orderForCompare } from '../features/compare/diff';
import { api, errorMessage } from '../lib/api';
import { formatMs, formatNumber, relativeTime, shortId } from '../lib/format';
import { PageContainer, PageHeader } from '../shell/Page';
import { Button, EmptyState, Pill, Select, Skeleton, StatusDot, TBody, TD, TH, THead, TR, Table, Tooltip, buttonClass, type StatusKind, type Tone } from '../ui';

const ISO: Record<string, string> = { 'READ UNCOMMITTED': 'RU', 'READ COMMITTED': 'RC', 'REPEATABLE READ': 'RR', SERIALIZABLE: 'SER' };
const KIND_OPTIONS = [{ value: 'all', label: 'All kinds' }, { value: 'LOAD', label: 'Load' }, { value: 'CAPACITY', label: 'Capacity' }, { value: 'STRATEGY_CHILD', label: 'Compare (strategy runs)' }];
const VERDICT_OPTIONS = [{ value: 'all', label: 'Any verdict' }, { value: 'pass', label: 'Pass' }, { value: 'fail', label: 'Fail' }];
const STATUS_DOT: Record<RunStatus, { dot: StatusKind; pulse?: boolean }> = {
  QUEUED: { dot: 'info', pulse: true }, PROVISIONING: { dot: 'info', pulse: true }, WARMING: { dot: 'info', pulse: true }, RUNNING: { dot: 'info', pulse: true }, ANALYZING: { dot: 'info', pulse: true },
  COMPLETED: { dot: 'ok' }, FAILED: { dot: 'bad' }, CANCELLED: { dot: 'idle' },
};
const KIND_TONE: Record<RunKind, Tone> = { LOAD: 'neutral', CAPACITY: 'accent', STRATEGY_CHILD: 'blue' };

function VerdictCell({ r }: { r: RunSummary }) {
  if (r.status === 'FAILED') return <Pill tone="red">FAILED</Pill>;
  if (!isTerminal(r.status)) return <span className="text-faint">-</span>;
  if (r.sloPass === null) return <span className="text-faint">-</span>;
  return <Pill tone={r.sloPass ? 'green' : 'red'}>{r.sloPass ? 'PASS' : 'FAIL'}</Pill>;
}

export default function RunsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const projectId = params.get('projectId') ?? 'all';
  const kind = params.get('kind') ?? 'all';
  const verdict = params.get('verdict') ?? 'all';
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(() => (params.get('select') ? [params.get('select')!] : []));

  const setFilter = (key: string, value: string) => setParams((p) => { const n = new URLSearchParams(p); if (value === 'all') n.delete(key); else n.set(key, value); n.delete('select'); return n; }, { replace: true });

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (projectId !== 'all') q.set('projectId', projectId);
    if (kind !== 'all') q.set('kind', kind);
    if (verdict !== 'all') q.set('verdict', verdict);
    const s = q.toString();
    return s ? `?${s}` : '';
  }, [projectId, kind, verdict]);

  const load = useCallback(async () => {
    const res = await api.get<RunSummary[]>(`/runs${query}`);
    if (res.ok) { setRuns(res.body); setError(null); } else setError(errorMessage(res));
  }, [query]);

  useEffect(() => { setRuns(null); void load(); }, [load]);
  useEffect(() => { void api.get<ProjectSummary[]>('/projects').then((r) => { if (r.ok) setProjects(r.body); }); }, []);
  // Runs in progress refresh themselves.
  const live = !!runs?.some((r) => !isTerminal(r.status));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [live, load]);

  const byId = useMemo(() => new Map((runs ?? []).map((r) => [r.runId, r])), [runs]);
  const chosen = selected.map((id) => byId.get(id)).filter((r): r is RunSummary => !!r);
  const block = compareBlockReason(chosen);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_COMPARE ? s : [...s, id]));
  // A "Compare strategies" batch parent has no metrics: it links to the comparison of its child runs (when they are in this list).
  const batchIds = (parentId: string) => orderForCompare((runs ?? []).filter((c) => c.parentRunId === parentId && c.status === 'COMPLETED')).slice(0, MAX_COMPARE).map((c) => c.runId);
  const filtered = projectId !== 'all' || kind !== 'all' || verdict !== 'all';
  const projectOptions = [{ value: 'all', label: 'All projects' }, ...projects.map((p) => ({ value: p.projectId, label: p.name }))];
  if (projectId !== 'all' && !projects.some((p) => p.projectId === projectId)) projectOptions.push({ value: projectId, label: shortId(projectId) });

  const compareBtn = (
    <Button variant="primary" icon={<GitCompare size={14} />} disabled={block !== null} onClick={() => navigate(`/compare?ids=${orderForCompare(chosen).map((r) => r.runId).join(',')}`)} data-testid="compare-btn">
      Compare{chosen.length > 0 ? ` (${chosen.length})` : ''}
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Runs"
        description="Every load and capacity run with its verdict. Select two to five completed runs of one project to compare."
        actions={<>
          {selected.length > 0 && <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setSelected([])}>Clear</Button>}
          {block ? <Tooltip content={block}><span tabIndex={0}>{compareBtn}</span></Tooltip> : compareBtn}
        </>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <div className="w-[220px]"><Select aria-label="Project" value={projectId} onValueChange={(v) => setFilter('projectId', v)} options={projectOptions} /></div>
        <div className="w-[150px]"><Select aria-label="Kind" value={kind} onValueChange={(v) => setFilter('kind', v)} options={KIND_OPTIONS} /></div>
        <div className="w-[140px]"><Select aria-label="Verdict" value={verdict} onValueChange={(v) => setFilter('verdict', v)} options={VERDICT_OPTIONS} /></div>
        {filtered && <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>Clear filters</Button>}
        <span className="ml-auto text-xs text-faint">{runs ? `${runs.length}${runs.length === 200 ? '+' : ''} runs` : ''}{live ? ' · live' : ''}</span>
      </div>

      {error ? (
        <EmptyState icon={<Activity size={20} />} title="Could not load runs" description={error} actions={<Button icon={<RefreshCw size={14} />} onClick={() => void load()}>Retry</Button>} />
      ) : runs === null ? (
        <div className="flex flex-col gap-1.5" aria-busy="true" aria-label="Loading runs">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8 w-full rounded-md" />)}</div>
      ) : runs.length === 0 ? (
        <EmptyState
          icon={<Activity size={20} />}
          title={filtered ? 'No runs match these filters' : 'No runs yet'}
          description={filtered ? 'Loosen a filter to see more runs.' : 'Open a project in the Studio and start a load test. Runs appear here as soon as they are queued.'}
          actions={filtered ? <Button onClick={() => setParams({}, { replace: true })}>Clear filters</Button> : <Link to="/" className={buttonClass('primary', 'md')}>Go to projects</Link>}
        />
      ) : (
        <Table data-testid="runs-table">
          <THead>
            <TR>
              <TH className="w-9"><span className="sr-only">Select</span></TH>
              <TH>Started</TH><TH>Project</TH><TH>Kind</TH><TH>Strategy</TH><TH>Isolation</TH>
              <TH align="right">VUs</TH><TH align="right">TPS</TH><TH align="right">p95</TH><TH align="right">Errors</TH><TH align="right">Violations</TH><TH>Verdict</TH><TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {runs.map((r) => {
              const isCompare = r.strategy === 'compare';
              const done = isTerminal(r.status);
              const sel = selected.includes(r.runId);
              const st = STATUS_DOT[r.status];
              return (
                <TR key={r.runId} interactive selected={sel} onClick={() => navigate(isCompare && batchIds(r.runId).length >= 2 ? `/compare?ids=${batchIds(r.runId).join(',')}` : `/runs/${r.runId}`)} data-testid="run-row" data-run-id={r.runId}>
                  <TD onClick={(e) => e.stopPropagation()}>
                    {!isCompare && <input
                      type="checkbox" className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed" aria-label={`Select run ${shortId(r.runId)}`}
                      checked={sel} disabled={!sel && selected.length >= MAX_COMPARE} onChange={() => toggle(r.runId)}
                    />}
                  </TD>
                  <TD className="whitespace-nowrap text-muted" title={r.startedAt ?? undefined}>{r.startedAt ? relativeTime(r.startedAt) : 'queued'}</TD>
                  <TD className="max-w-[240px]" title={r.projectName}><span className="flex items-baseline gap-1.5"><span className="min-w-0 truncate">{r.projectName ?? shortId(r.projectId)}</span><span className="shrink-0 font-mono text-[11px] text-faint">rev {r.revisionNo}</span></span></TD>
                  <TD>{isCompare ? <Tooltip content="A Compare strategies batch: one short child run per strategy"><span><Pill tone="blue">batch</Pill></span></Tooltip> : <Pill tone={KIND_TONE[r.kind]}>{r.kind === 'STRATEGY_CHILD' ? 'compare' : r.kind.toLowerCase()}</Pill>}</TD>
                  <TD mono>{isCompare ? (batchIds(r.runId).length >= 2 ? <Link to={`/compare?ids=${batchIds(r.runId).join(',')}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">{batchIds(r.runId).length} runs</Link> : <span className="text-faint">batch</span>) : r.strategy}</TD>
                  <TD mono><Tooltip content={r.isolation}><span>{ISO[r.isolation] ?? r.isolation}</span></Tooltip></TD>
                  <TD align="right" mono>{isCompare ? '-' : r.vus}</TD>
                  <TD align="right" mono>{done && !isCompare ? formatNumber(r.tpsAvg) : '-'}</TD>
                  <TD align="right" mono>{done && !isCompare ? formatMs(r.p95Ms) : '-'}</TD>
                  <TD align="right" mono className={r.errored > 0 ? 'text-bad' : undefined}>{done && !isCompare ? formatNumber(r.errored) : '-'}</TD>
                  <TD align="right" mono className={r.invariantViolations > 0 ? 'text-bad' : undefined}>{done && !isCompare ? formatNumber(r.invariantViolations) : '-'}</TD>
                  <TD>{isCompare ? <span className="text-faint">-</span> : <VerdictCell r={r} />}</TD>
                  <TD><span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted"><StatusDot status={st.dot} pulse={st.pulse} />{r.status.toLowerCase()}</span></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </PageContainer>
  );
}
