import { RefreshCw, SearchX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { isTerminal, type RunReport } from '@datasim/shared';
import { LiveRun } from '../features/report/LiveRun';
import { ReportView } from '../features/report/ReportView';
import { api, errorMessage } from '../lib/api';
import { PageContainer } from '../shell/Page';
import { Button, EmptyState, Skeleton, buttonClass } from '../ui';

type Load = { state: 'loading' } | { state: 'ready'; report: RunReport } | { state: 'error'; notFound: boolean; message: string };

function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading run report">
      <Skeleton className="mb-2 h-4 w-32" />
      <Skeleton className="mb-3 h-7 w-72" />
      <Skeleton className="mb-6 h-5 w-96" />
      <div className="mb-6 grid grid-cols-5 gap-2">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-[76px] rounded-lg" />)}</div>
      <div className="grid grid-cols-2 gap-2"><Skeleton className="h-[240px] rounded-lg" /><Skeleton className="h-[240px] rounded-lg" /></div>
    </div>
  );
}

export default function RunReportPage() {
  const { id = '' } = useParams();
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  const fetchReport = useCallback(async () => {
    const res = await api.get<RunReport>(`/runs/${id}`);
    if (res.ok) setLoad({ state: 'ready', report: res.body });
    else setLoad({ state: 'error', notFound: res.status === 404, message: errorMessage(res) });
  }, [id]);

  useEffect(() => { setLoad({ state: 'loading' }); void fetchReport(); }, [fetchReport]);
  // A run that was in flight when its page opened: swap in the final report once it is terminal.
  const finished = useCallback(() => { void fetchReport(); }, [fetchReport]);

  return (
    <PageContainer>
      {load.state === 'loading' && <ReportSkeleton />}
      {load.state === 'error' && (
        <EmptyState
          icon={<SearchX size={20} />}
          title={load.notFound ? 'Run not found' : 'Could not load this run'}
          description={load.notFound ? 'It may have been deleted, or the link is wrong. Pick a run from the list.' : load.message}
          actions={<>
            <Link to="/runs" className={buttonClass('secondary', 'md')}>All runs</Link>
            {!load.notFound && <Button icon={<RefreshCw size={14} />} onClick={() => { setLoad({ state: 'loading' }); void fetchReport(); }}>Retry</Button>}
          </>}
        />
      )}
      {load.state === 'ready' && (isTerminal(load.report.run.status) ? <ReportView key={load.report.run.runId} report={load.report} /> : <LiveRun key={load.report.run.runId} report={load.report} onDone={finished} />)}
    </PageContainer>
  );
}
