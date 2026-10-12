import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { DesignDoc } from '@datasim/shared';
import '../../../index.css';
import { ThemeProvider } from '../../../lib/theme';
import { ToastProvider, TooltipProvider } from '../../../ui';
import { useDesignStore } from '../../../lib/designStore';
import { SchemaDesigner } from '..';
import { WorkloadEditor } from '../../workload';

const q = new URLSearchParams(location.search);
function App() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<'schema' | 'workload' | null>((q.get('open') as 'schema' | 'workload') ?? 'schema');
  useEffect(() => {
    (async () => {
      const id = q.get('p')!;
      const r = await fetch(`/api/projects/${id}`);
      const p = await r.json();
      useDesignStore.getState().load(id, DesignDoc.parse(p.design), null);
      (window as unknown as { store: unknown }).store = useDesignStore;
      setReady(true);
    })();
  }, []);
  if (!ready) return <div>loading</div>;
  return (
    <>
      <button onClick={() => setOpen('schema')}>schema</button>
      <button onClick={() => setOpen('workload')}>workload</button>
      <SchemaDesigner open={open === 'schema'} onClose={() => setOpen(null)} focusTable={q.get('focus') ?? undefined} />
      <WorkloadEditor open={open === 'workload'} onClose={() => setOpen(null)} />
    </>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(<ThemeProvider><TooltipProvider><ToastProvider><App /></ToastProvider></TooltipProvider></ThemeProvider>);
