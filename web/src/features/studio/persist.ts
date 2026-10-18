import { useEffect } from 'react';
import type { DesignDoc } from '@datasim/shared';
import { api, errorMessage } from '../../lib/api';
import { useDesignStore } from '../../lib/designStore';

export const AUTOSAVE_MS = 800;

/** The design object the server is known to hold. Undo back to this exact object is "clean" again. */
const sync = { saved: null as DesignDoc | null, timer: null as ReturnType<typeof setTimeout> | null, chain: Promise.resolve(true) as Promise<boolean>, lastError: '' };

/** Every programmatic replacement of the document (project open, apply-fix reload) goes through here so autosave does not echo it back. */
export function loadDesign(projectId: string, design: DesignDoc, revisionNo: number | null, pinnedDirty = false): void {
  sync.saved = design;
  useDesignStore.getState().load(projectId, design, revisionNo, pinnedDirty);
}

export const lastSaveError = () => sync.lastError;

async function saveNow(): Promise<boolean> {
  const { projectId, design } = useDesignStore.getState();
  if (!projectId || design === sync.saved) return true;
  useDesignStore.getState().setSaveStatus('saving');
  const res = await api.put(`/projects/${projectId}/draft`, design);
  const st = useDesignStore.getState();
  if (st.projectId !== projectId) return res.ok; // user navigated away mid-save
  if (!res.ok) { sync.lastError = errorMessage(res); st.setSaveStatus('error'); return false; }
  sync.lastError = '';
  sync.saved = design;
  st.setSaveStatus(st.design === design ? 'saved' : 'dirty');
  return true;
}

/** Saves the draft now (serialised behind any save in flight). Resolves false when the server rejected it. */
export function flushSave(): Promise<boolean> {
  if (sync.timer) { clearTimeout(sync.timer); sync.timer = null; }
  sync.chain = sync.chain.then(saveNow, saveNow);
  return sync.chain;
}

function schedule() {
  if (sync.timer) clearTimeout(sync.timer);
  sync.timer = setTimeout(() => { sync.timer = null; void flushSave(); }, AUTOSAVE_MS);
}

/** Watches the design and PUTs the draft (debounced). Mount once in the Studio. */
export function useDraftAutosave(projectId: string | null): void {
  useEffect(() => {
    if (!projectId) return;
    const unsub = useDesignStore.subscribe((s, prev) => {
      if (s.design === prev.design || s.projectId !== projectId) return;
      if (s.design === sync.saved) { // undo/redo back to what the server has
        if (sync.timer) { clearTimeout(sync.timer); sync.timer = null; }
        if (s.saveStatus !== 'saved') useDesignStore.setState({ saveStatus: 'saved' });
        return;
      }
      if (s.saveStatus !== 'dirty' || !s.pinnedDirty) useDesignStore.setState({ saveStatus: 'dirty', pinnedDirty: true });
      schedule();
    });
    const warn = (e: BeforeUnloadEvent) => {
      const st = useDesignStore.getState().saveStatus;
      if (st === 'dirty' || st === 'saving') { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', warn);
      // Leaving the Studio: push any pending edit out now rather than dropping it.
      if (sync.timer) void flushSave();
    };
  }, [projectId]);
}
