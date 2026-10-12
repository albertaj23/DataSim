import { ArrowLeft, RefreshCw, SearchX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DesignDoc, type ProjectDetail } from '@datasim/shared';
import { api, errorMessage } from '../lib/api';
import { Button, EmptyState, Skeleton, buttonClass, useToast } from '../ui';
import { Studio } from '../features/studio/Studio';
import { loadDesign } from '../features/studio/persist';
import { useStudioUi } from '../features/studio/studioUi';

type Load = { state: 'loading' } | { state: 'ready'; name: string } | { state: 'error'; notFound: boolean; message: string };

function StudioSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true" aria-label="Loading project">
      <div className="flex h-12 items-center gap-3 border-b border-line bg-surface px-3"><Skeleton className="h-5 w-56" /><Skeleton className="ml-auto h-7 w-72" /></div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[232px] border-r border-line bg-surface p-3"><Skeleton className="mb-3 h-8 w-full" /><Skeleton className="mb-2 h-12 w-full" /><Skeleton className="mb-2 h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        <div className="canvas-grid min-w-0 flex-1" />
        <div className="w-80 border-l border-line bg-surface p-3"><Skeleton className="mb-3 h-5 w-24" /><Skeleton className="h-24 w-full" /></div>
      </div>
      <div className="h-[280px] border-t border-line bg-surface" />
    </div>
  );
}

/** Full-bleed: no page padding. Loads the project's draft into the design store, then renders the Studio. */
export default function StudioPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  const fetchProject = useCallback(async () => {
    setLoad({ state: 'loading' });
    const res = await api.get<ProjectDetail>(`/projects/${id}`);
    if (!res.ok) {
      setLoad({ state: 'error', notFound: res.status === 404 || res.status === 400, message: res.status === 404 ? 'This project does not exist or was removed.' : errorMessage(res) });
      return;
    }
    const parsed = DesignDoc.safeParse(res.body.design);
    useStudioUi.getState().reset();
    loadDesign(id, parsed.success ? parsed.data : res.body.design, res.body.pinnedRevisionNo, res.body.dirty);
    setLoad({ state: 'ready', name: res.body.name });
  }, [id]);

  useEffect(() => { void fetchProject(); }, [fetchProject]);

  const rename = useCallback(async (name: string) => {
    const res = await api.patch<ProjectDetail>(`/projects/${id}`, { name });
    if (!res.ok) { toast.error('Could not rename', errorMessage(res)); return; }
    setLoad((l) => (l.state === 'ready' ? { ...l, name } : l));
  }, [id, toast]);

  if (load.state === 'loading') return <StudioSkeleton />;
  if (load.state === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<SearchX size={20} />} title={load.notFound ? 'Project not found' : 'Could not open the project'} description={load.message}
          actions={<>
            <Link to="/" className={buttonClass('secondary')}><ArrowLeft size={14} />Projects</Link>
            {!load.notFound && <Button icon={<RefreshCw size={14} />} onClick={() => void fetchProject()}>Retry</Button>}
          </>}
        />
      </div>
    );
  }
  // `key` remounts the Studio (and its canvas) when navigating between projects.
  return <Studio key={id} projectId={id} name={load.name} onRename={(n) => void rename(n)} />;
}
