import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { validateDesign, type DesignDoc, type Problem, type ValidateResponse } from '@datasim/shared';
import { api, errorMessage } from '../../lib/api';
import { useDesignStore } from '../../lib/designStore';
import { useToast } from '../../ui';
import { SchemaDesigner } from '../schema';
import { useStudioCommands } from '../tier2/studioCommands';
import { WorkloadEditor } from '../workload';
import { useStudioActions } from './actions';
import { BottomPanel } from './BottomPanel';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { NodeHealthContext } from './NodeCard';
import { Palette } from './Palette';
import { flushSave, useDraftAutosave } from './persist';
import { healthByNode, mergeProblems } from './problems';
import { RunController, useRunActions } from './runFlow';
import { useStudioUi } from './studioUi';
import { TopBar } from './TopBar';

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || !!el.closest?.('.cm-editor'));
};

/** Undo/redo, duplicate and run shortcuts. Delete is handled by React Flow. Skipped while typing or while a dialog/overlay is open. */
function useStudioShortcuts(run: ReturnType<typeof useRunActions>) {
  const actions = useStudioActions();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) actions.redo(); else actions.undo(); }
      else if (k === 'y') { e.preventDefault(); actions.redo(); }
      else if (k === 'd') { e.preventDefault(); const id = useStudioUi.getState().selectedNode; if (id) actions.duplicate(id); }
      else if (e.key === 'Enter') { e.preventDefault(); void run.start('LOAD'); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [actions, run]);
}

function Body({ projectId, name, onRename }: { projectId: string; name: string; onRename: (n: string) => void }) {
  const toast = useToast();
  const design = useDesignStore((s) => s.design);
  const run = useRunActions(projectId);
  const schemaOpen = useStudioUi((s) => s.schemaOpen);
  const schemaFocus = useStudioUi((s) => s.schemaFocus);
  const workloadOpen = useStudioUi((s) => s.workloadOpen);
  const [server, setServer] = useState<{ design: DesignDoc; problems: Problem[] } | null>(null);
  const [checking, setChecking] = useState(false);

  useDraftAutosave(projectId);
  useStudioShortcuts(run);
  useStudioCommands(projectId, name, run);

  const client = useMemo(() => validateDesign(design), [design]);
  const problems = useMemo(() => mergeProblems(client, server && server.design === design ? server.problems : []), [client, server, design]);
  const health = useMemo(() => healthByNode(problems, design), [problems, design]);

  const validateOnServer = useCallback(async () => {
    const d = useDesignStore.getState().design;
    setChecking(true);
    const res = await api.post<ValidateResponse>(`/projects/${projectId}/validate`, { design: d });
    setChecking(false);
    if (res.ok && Array.isArray(res.body.problems)) setServer({ design: d, problems: res.body.problems });
    else if (res.status !== 0) toast.error('Server validation failed', errorMessage(res));
  }, [projectId, toast]);

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg">
      <NodeHealthContext.Provider value={health}>
        <TopBar projectId={projectId} name={name} onRename={onRename} problems={problems} checking={checking} onValidate={() => void validateOnServer()} run={run} />
        <div className="flex min-h-0 flex-1">
          <Palette />
          <div className="canvas-grid min-w-0 flex-1"><Canvas /></div>
          <Inspector />
        </div>
        <BottomPanel run={run} />
      </NodeHealthContext.Provider>
      <RunController projectId={projectId} />
      <SchemaDesigner open={schemaOpen} focusTable={schemaFocus} onClose={() => useStudioUi.getState().closeSchema()} />
      <WorkloadEditor open={workloadOpen} onClose={() => useStudioUi.getState().closeWorkload()} />
    </div>
  );
}

/** The Studio shell for one loaded project (StudioPage handles fetching). */
export function Studio({ projectId, name, onRename }: { projectId: string; name: string; onRename: (n: string) => void }) {
  useEffect(() => () => { void flushSave(); }, [projectId]);
  return (
    <ReactFlowProvider>
      <Body projectId={projectId} name={name} onRename={onRename} />
    </ReactFlowProvider>
  );
}
