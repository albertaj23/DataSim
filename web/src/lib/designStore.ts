import { create } from 'zustand';
import { temporal } from 'zundo';
import { emptyDesign, type DesignDoc } from '@datasim/shared';

/**
 * The one editor document shared by the Studio canvas, inspector, Schema Designer and Workload Editor.
 * Undo/redo (zundo) tracks `design` only. Autosave is wired by the Studio (it watches `design` and PUTs the draft).
 */
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface DesignState {
  projectId: string | null;
  design: DesignDoc;
  /** Latest pinned revision (null before the first Save/Run). */
  revisionNo: number | null;
  saveStatus: SaveStatus;
  /** True when the draft differs from the latest pinned revision (drives the Save button). */
  pinnedDirty: boolean;
  /** Replace the document without creating an undo step (initial load, revert). */
  load: (projectId: string, design: DesignDoc, revisionNo: number | null, pinnedDirty?: boolean) => void;
  /** Mutate a deep copy of the design; marks dirty and creates one undo step. */
  update: (mutate: (draft: DesignDoc) => void) => void;
  setSaveStatus: (s: SaveStatus) => void;
  /** Records a newly pinned revision (clears pinnedDirty). */
  setRevisionNo: (n: number | null) => void;
  setPinnedDirty: (v: boolean) => void;
}

export const useDesignStore = create<DesignState>()(
  temporal(
    (set, get) => ({
      projectId: null,
      design: emptyDesign(),
      revisionNo: null,
      saveStatus: 'idle',
      pinnedDirty: false,
      load: (projectId, design, revisionNo, pinnedDirty = false) => {
        set({ projectId, design, revisionNo, saveStatus: 'saved', pinnedDirty });
        useDesignStore.temporal.getState().clear();
      },
      update: (mutate) => {
        const draft = structuredClone(get().design);
        mutate(draft);
        set({ design: draft, saveStatus: 'dirty', pinnedDirty: true });
      },
      setSaveStatus: (saveStatus) => set({ saveStatus }),
      setRevisionNo: (revisionNo) => set({ revisionNo, pinnedDirty: false }),
      setPinnedDirty: (pinnedDirty) => set({ pinnedDirty }),
    }),
    {
      partialize: (s) => ({ design: s.design }),
      limit: 100,
      equality: (a, b) => a.design === b.design,
    },
  ),
);

export const undo = () => useDesignStore.temporal.getState().undo();
export const redo = () => useDesignStore.temporal.getState().redo();
