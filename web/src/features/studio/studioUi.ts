import { create } from 'zustand';

export const PANEL_TABS = ['live', 'transactions', 'statements', 'locks', 'invariants', 'findings', 'log'] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

export const PANEL_MIN = 160;
export const PANEL_HEADER = 33;
export const clampPanel = (h: number, viewportH: number) => Math.round(Math.min(Math.max(h, PANEL_MIN), Math.max(PANEL_MIN, viewportH * 0.7)));

/** Bottom panel starts at about a third of the viewport (short screens keep room for the canvas). */
export const defaultPanelHeight = (viewportH: number) => clampPanel(Math.min(300, viewportH * 0.36), viewportH);

interface StudioUi {
  selectedNode: string | null;
  selectedEdge: string | null;
  panelOpen: boolean;
  panelHeight: number;
  tab: PanelTab;
  schemaOpen: boolean;
  schemaFocus: string | undefined;
  workloadOpen: boolean;
  /** Bumped to ask the inspector to focus its first field (double-click, Configure). */
  focusTick: number;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  openPanel: (tab?: PanelTab) => void;
  setTab: (t: PanelTab) => void;
  togglePanel: () => void;
  setPanelHeight: (h: number) => void;
  openSchema: (focusTable?: string) => void;
  closeSchema: () => void;
  openWorkload: () => void;
  closeWorkload: () => void;
  focusInspector: () => void;
  reset: () => void;
}

export const useStudioUi = create<StudioUi>()((set) => ({
  selectedNode: null, selectedEdge: null, panelOpen: true, panelHeight: defaultPanelHeight(typeof window === 'undefined' ? 900 : window.innerHeight), tab: 'live',
  schemaOpen: false, schemaFocus: undefined, workloadOpen: false, focusTick: 0,
  selectNode: (selectedNode) => set({ selectedNode, selectedEdge: null }),
  selectEdge: (selectedEdge) => set({ selectedEdge, selectedNode: null }),
  openPanel: (tab) => set((s) => ({ panelOpen: true, tab: tab ?? s.tab })),
  setTab: (tab) => set({ tab, panelOpen: true }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelHeight: (panelHeight) => set({ panelHeight }),
  openSchema: (schemaFocus) => set({ schemaOpen: true, schemaFocus }),
  closeSchema: () => set({ schemaOpen: false, schemaFocus: undefined }),
  openWorkload: () => set({ workloadOpen: true }),
  closeWorkload: () => set({ workloadOpen: false }),
  focusInspector: () => set((s) => ({ focusTick: s.focusTick + 1 })),
  reset: () => set({ selectedNode: null, selectedEdge: null, schemaOpen: false, workloadOpen: false }),
}));
