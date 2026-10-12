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
  /** Replace the document without creating an undo step (initial load, revert). */
  load: (projectId: string, design: DesignDoc, revisionNo: number | null) => void;
  /** Mutate a deep copy of the design; marks dirty and creates one undo step. */
  update: (mutate: (draft: DesignDoc) => void) => void;
  setSaveStatus: (s: SaveStatus) => void;
  setRevisionNo: (n: number | null) => void;
}

export const useDesignStore = create<DesignState>()(
  temporal(
    (set, get) => ({
      projectId: null,
      design: emptyDesign(),
      revisionNo: null,
      saveStatus: 'idle',
      load: (projectId, design, revisionNo) => {
        set({ projectId, design, revisionNo, saveStatus: 'saved' });
        useDesignStore.temporal.getState().clear();
      },
      update: (mutate) => {
        const draft = structuredClone(get().design);
        mutate(draft);
        set({ design: draft, saveStatus: 'dirty' });
      },
      setSaveStatus: (saveStatus) => set({ saveStatus }),
      setRevisionNo: (revisionNo) => set({ revisionNo }),
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
