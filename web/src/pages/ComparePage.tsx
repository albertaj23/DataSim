import { GitCompare, Link2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CompareResponse, RunReport, RunSummary } from '@datasim/shared';
import { CompareCharts } from '../features/compare/CompareCharts';
import { DesignDiff } from '../features/compare/DesignDiff';
import { MAX_COMPARE, MIN_COMPARE, runLabels } from '../features/compare/diff';
import { FindingsDiff, InvariantMatrix } from '../features/compare/Matrices';
import { MetricTable } from '../features/compare/MetricTable';
import { RunStrip } from '../features/compare/RunStrip';
import { api, errorMessage } from '../lib/api';
import { PageContainer, PageHeader } from '../shell/Page';
import { Button, EmptyState, Skeleton, buttonClass, useToast } from '../ui';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const parseIds = (raw: string | null) => [...new Set((raw ?? '').split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))].slice(0, MAX_COMPARE);

function CompareSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading comparison">
      <div className="mb-5 flex gap-2"><Skeleton className="h-[88px] flex-1 rounded-lg" /><Skeleton className="h-[88px] flex-1 rounded-lg" /></div>
      <Skeleton className="mb-5 h-[300px] w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-2"><Skeleton className="h-[240px] rounded-lg" /><Skeleton className="h-[240px] rounded-lg" /></div>
    </div>
  );
}

export default function ComparePage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const ids = useMemo(() => parseIds(params.get('ids')), [params]);
  const idKey = [...ids].sort().join(',');
  const [cache, setCache] = useState<Map<string, RunReport>>(new Map());
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<RunSummary[]>([]);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const fetchRuns = useCallback(async () => {
    if (ids.length < MIN_COMPARE || ids.every((id) => cacheRef.current.has(id))) return;
    setLoading(true); setError(null);
    const res = await api.post<CompareResponse>('/compare', { runIds: ids });
    setLoading(false);
    if (!res.ok) { setError({ message: errorMessage(res), code: (res.body as { code?: string }).code }); return; }
    setCache(new Map(res.body.runs.map((r) => [r.run.runId, r])));
  }, [idKey]);

  useEffect(() => { void fetchRuns(); }, [fetchRuns]);

  const runs = useMemo(() => ids.map((id) => cache.get(id)).filter((r): r is RunReport => !!r), [ids, cache]);
  const ready = runs.length === ids.length && ids.length >= MIN_COMPARE;
  const projectId = runs[0]?.run.projectId;

  useEffect(() => {
    if (!projectId) return;
    void api.get<RunSummary[]>(`/runs?projectId=${projectId}`).then((r) => { if (r.ok) setCandidates(r.body.filter((x) => x.status === 'COMPLETED' && x.strategy !== 'compare' && !ids.includes(x.runId))); });
  }, [projectId, ids]);

  const setIds = (next: string[]) => setParams(next.length ? { ids: next.join(',') } : {}, { replace: true });
  const labels = useMemo(() => runLabels(runs), [runs]);
  const move = (from: number, to: number) => { const n = [...ids]; const [x] = n.splice(from, 1); n.splice(to, 0, x!); setIds(n); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast.success('Link copied', 'Anyone with access to this DataSim instance can open the same comparison.'); }
    catch { toast.error('Could not copy', 'Copy the address from the browser bar instead.'); }
  };

  const description = ready ? `${runs[0]!.run.projectName ?? 'Project'} · ${runs.length} runs · deltas are against run A` : 'Side-by-side metrics, invariants, findings and design changes for two to four runs.';

  return (
    <PageContainer>
      <PageHeader
        title="Compare"
        description={description}
        actions={ready ? <><Button icon={<Link2 size={14} />} onClick={() => void copy()}>Copy link</Button><Link to={`/runs?projectId=${projectId}`} className={buttonClass('secondary', 'md')}>All runs</Link></> : undefined}
      />
      {ids.length < MIN_COMPARE ? (
        <EmptyState
          icon={<GitCompare size={20} />} title="Pick runs to compare"
          description="Select two to four completed runs of the same project on the Runs page, or run Compare strategies from the Studio."
          actions={<Link to="/runs" className={buttonClass('primary', 'md')}>Choose runs</Link>}
        />
      ) : error ? (
        <EmptyState
          icon={<GitCompare size={20} />}
          title={error.code === 'DIFFERENT_PROJECTS' ? 'These runs belong to different projects' : error.code === 'NOT_FOUND' ? 'A run in this link no longer exists' : 'Could not load the comparison'}
          description={error.message}
          actions={<><Link to="/runs" className={buttonClass('secondary', 'md')}>Choose runs</Link>{error.code !== 'NOT_FOUND' && error.code !== 'DIFFERENT_PROJECTS' && <Button icon={<RefreshCw size={14} />} onClick={() => void fetchRuns()}>Retry</Button>}</>}
        />
      ) : loading || !ready ? (
        <CompareSkeleton />
      ) : (
        <div data-testid="compare">
          <RunStrip runs={runs} labels={labels} candidates={candidates} onMove={move} onRemove={(id) => setIds(ids.filter((x) => x !== id))} onAdd={(id) => setIds([...ids, id])} />
          <div className="flex flex-col gap-6">
            <MetricTable runs={runs} labels={labels} />
            <CompareCharts runs={runs} labels={labels} />
            <InvariantMatrix runs={runs} labels={labels} />
            <FindingsDiff runs={runs} labels={labels} />
            <DesignDiff runs={runs} labels={labels} />
          </div>
        </div>
      )}
    </PageContainer>
  );
}
