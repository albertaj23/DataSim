import { useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { NodeType } from '@datasim/shared';
import { redo, undo, useDesignStore } from '../../lib/designStore';
import { useToast } from '../../ui';
import { FIT, autoLayout } from './layout';
import { addNode, duplicateNode, removeItems } from './nodes';
import { useStudioUi } from './studioUi';

/** Canvas-level edits shared by the palette, node cards, keyboard shortcuts and the top bar. All go through the design store (undoable). */
export function useStudioActions() {
  const toast = useToast();
  const rf = useReactFlow();

  return useMemo(() => {
    const ui = () => useStudioUi.getState();
    const update = (fn: Parameters<ReturnType<typeof useDesignStore.getState>['update']>[0]) => useDesignStore.getState().update(fn);

    /** Appends to `design.nodes`, so the new node is the last one. */
    const selectLast = () => {
      const nodes = useDesignStore.getState().design.nodes;
      const last = nodes[nodes.length - 1];
      if (last) ui().selectNode(last.id);
      return last ?? null;
    };

    const add = (type: NodeType, position?: { x: number; y: number }) => {
      // Check on a copy first: `update` always records an undo step, and a rejected add must not.
      const check = addNode(structuredClone(useDesignStore.getState().design), type, position);
      if (!check.ok) { toast.error('Cannot add node', check.reason); return null; }
      update((d) => { addNode(d, type, position); });
      return selectLast();
    };

    const duplicate = (id: string) => {
      const check = duplicateNode(structuredClone(useDesignStore.getState().design), id);
      if (!check.ok) { toast.error('Cannot duplicate', check.reason); return; }
      update((d) => { duplicateNode(d, id); });
      selectLast();
    };

    const remove = (nodeIds: string[], edgeIds: string[] = []) => {
      if (!nodeIds.length && !edgeIds.length) return;
      update((d) => removeItems(d, nodeIds, edgeIds));
      const s = ui();
      if (s.selectedNode && nodeIds.includes(s.selectedNode)) s.selectNode(null);
      if (s.selectedEdge && edgeIds.includes(s.selectedEdge)) s.selectEdge(null);
    };

    const layout = () => {
      const pos = autoLayout(useDesignStore.getState().design);
      update((d) => { for (const n of d.nodes) { const p = pos[n.id]; if (p) n.position = p; } });
      requestAnimationFrame(() => requestAnimationFrame(() => void rf.fitView({ ...FIT, duration: 200 })));
    };

    /** Select a node, bring it into view and move keyboard focus to the inspector. */
    const configure = (id: string) => { ui().selectNode(id); ui().focusInspector(); };

    const center = (id: string) => {
      const n = useDesignStore.getState().design.nodes.find((x) => x.id === id);
      if (n) void rf.setCenter(n.position.x + 124, n.position.y + 32, { zoom: Math.max(rf.getZoom(), 0.9), duration: 250 });
    };

    return { add, duplicate, remove, layout, configure, center, undo, redo };
  }, [toast, rf]);
}
