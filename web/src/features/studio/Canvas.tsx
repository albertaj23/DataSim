import {
  Background, BackgroundVariant, ConnectionLineType, Controls, MiniMap, Panel, ReactFlow, applyEdgeChanges, applyNodeChanges, useReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type OnConnectEnd, type OnConnectStart,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Redo2, Undo2, Workflow } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useStore } from 'zustand';
import type { NodeType } from '@datasim/shared';
import { useDesignStore } from '../../lib/designStore';
import { IconButton, useToast } from '../../ui';
import { useStudioActions } from './actions';
import { checkConnection, invalidTargets, resolveDrop } from './connect';
import { FIT, NODE_H, NODE_W } from './layout';
import { LinkEdge } from './LinkEdge';
import { NodeCard } from './NodeCard';
import { newEdge } from './nodes';
import { useStudioUi } from './studioUi';
import './studio.css';

export const DND_MIME = 'application/x-datasim-node';
const nodeTypes = { card: NodeCard };
const edgeTypes = { link: LinkEdge };
const defaultEdgeOptions = { type: 'link' } as const;
/** Below this viewport height the minimap would cover nodes, so it is hidden. */
const MINIMAP_MIN_VIEWPORT_H = 820;

function useViewportHeight() {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

export function Canvas() {
  const design = useDesignStore((s) => s.design);
  const projectId = useDesignStore((s) => s.projectId);
  const selectedNode = useStudioUi((s) => s.selectedNode);
  const selectedEdge = useStudioUi((s) => s.selectedEdge);
  const toast = useToast();
  const actions = useStudioActions();
  const rf = useReactFlow();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [connecting, setConnecting] = useState(false);
  const pastLen = useStore(useDesignStore.temporal, (s) => s.pastStates.length);
  const futureLen = useStore(useDesignStore.temporal, (s) => s.futureStates.length);
  const wrapper = useRef<HTMLDivElement>(null);
  const viewportH = useViewportHeight();
  /** Set while a connection drag is open and when it already produced an edge (onConnect runs before onConnectEnd). */
  const connected = useRef(false);
  /** The user panned or zoomed by hand: stop re-fitting when the container resizes. */
  const userMoved = useRef(false);

  // Store -> canvas. Reuse previous node objects when nothing changed so React Flow keeps its measured sizes.
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return design.nodes.map((n) => {
        const old = byId.get(n.id);
        if (old && old.position.x === n.position.x && old.position.y === n.position.y) return old;
        return old ? { ...old, position: n.position } : { id: n.id, type: 'card', position: n.position, data: {}, selected: n.id === selectedNode };
      });
    });
    // selectedNode is applied by the effect below; intentionally not a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.nodes]);
  useEffect(() => {
    setEdges((prev) => {
      const byId = new Map(prev.map((e) => [e.id, e]));
      return design.edges.map((e) => byId.get(e.id) ?? { id: e.id, source: e.source, target: e.target, type: 'link', selected: e.id === selectedEdge });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.edges]);

  // UI selection (palette add, validate popover, edge label click) -> canvas. Multi-select (both null) is left alone.
  useEffect(() => {
    if (!selectedNode && !selectedEdge) return;
    setNodes((ns) => ns.map((n) => (n.selected === (n.id === selectedNode) ? n : { ...n, selected: n.id === selectedNode })));
    setEdges((es) => es.map((e) => (e.selected === (e.id === selectedEdge) ? e : { ...e, selected: e.id === selectedEdge })));
  }, [selectedNode, selectedEdge]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Deletions go through the store (one undo step, edges cleaned up); everything else is canvas-local until drag end.
    setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), ns));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), es));
  }, []);

  const onNodeDragStop = useCallback((_: unknown, __: Node, dragged: Node[]) => {
    const cur = useDesignStore.getState().design.nodes;
    const moved = dragged.filter((d) => { const n = cur.find((x) => x.id === d.id); return n && (n.position.x !== d.position.x || n.position.y !== d.position.y); });
    if (!moved.length) return;
    useDesignStore.getState().update((d) => {
      for (const m of moved) { const n = d.nodes.find((x) => x.id === m.id); if (n) n.position = { x: m.position.x, y: m.position.y }; }
    });
  }, []);

  const onSelectionChange = useCallback(({ nodes: ns, edges: es }: { nodes: Node[]; edges: Edge[] }) => {
    const ui = useStudioUi.getState();
    if (ns.length === 1 && es.length === 0) { if (ui.selectedNode !== ns[0]!.id) ui.selectNode(ns[0]!.id); }
    else if (es.length === 1 && ns.length === 0) { if (ui.selectedEdge !== es[0]!.id) ui.selectEdge(es[0]!.id); }
    else if (ui.selectedNode || ui.selectedEdge) { useStudioUi.setState({ selectedNode: null, selectedEdge: null }); }
  }, []);

  const isValidConnection = useCallback((c: Connection | Edge) => checkConnection(useDesignStore.getState().design, c.source, c.target).ok, []);

  const onConnect = useCallback((c: Connection) => {
    const d = useDesignStore.getState().design;
    if (!checkConnection(d, c.source, c.target).ok) return;
    connected.current = true;
    useDesignStore.getState().update((draft) => { draft.edges.push(newEdge(draft, c.source, c.target)); });
  }, []);

  const dim = useCallback((ids: Set<string>) => setNodes((ns) => ns.map((n) => { const cls = ids.has(n.id) ? 'ds-dim' : undefined; return n.className === cls ? n : { ...n, className: cls }; })), []);

  const onConnectStart: OnConnectStart = useCallback((_e, { nodeId, handleType }) => {
    connected.current = false;
    setConnecting(true);
    if (nodeId) dim(invalidTargets(useDesignStore.getState().design, nodeId, handleType));
  }, [dim]);

  // A drag released anywhere over a node (not only on its ~10 px handle): valid links connect, invalid ones explain themselves.
  const onConnectEnd: OnConnectEnd = useCallback((e, state) => {
    setConnecting(false);
    dim(new Set());
    if (connected.current || !state.fromNode) return;
    const pt = 'changedTouches' in e ? e.changedTouches[0] : e;
    const under = pt ? document.elementFromPoint(pt.clientX, pt.clientY)?.closest<HTMLElement>('.react-flow__node')?.dataset.id : undefined;
    const drop = resolveDrop(useDesignStore.getState().design, state.fromNode.id, state.fromHandle?.type, under ?? state.toNode?.id);
    if (!drop) return;
    if (!drop.result.ok) toast.error('Connection not allowed', drop.result.reason);
    else useDesignStore.getState().update((draft) => { draft.edges.push(newEdge(draft, drop.source, drop.target)); });
  }, [toast, dim]);

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData(DND_MIME) as NodeType;
    if (!type) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    actions.add(type, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  };

  // Re-fit when a different project opens.
  useEffect(() => {
    userMoved.current = false;
    const t = setTimeout(() => void rf.fitView(FIT), 60);
    return () => clearTimeout(t);
  }, [projectId, rf]);

  // Re-fit when the container resizes (window, bottom panel), unless the user has placed the view by hand.
  useEffect(() => {
    const el = wrapper.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => { if (!userMoved.current) void rf.fitView(FIT); }, 150);
    });
    ro.observe(el);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [rf]);

  const hint = design.nodes.length === 0
    ? { title: 'Start with Users, an App server and a Database', text: 'Drag components from the palette, or click one to add it. Then drag from a right-hand handle to connect them.' }
    : design.edges.length === 0 && design.nodes.length > 1
      ? { title: null, text: 'Drag from the handle on a node’s right edge to another node to connect them.' }
      : null;

  return (
    <div ref={wrapper} className={`ds-canvas relative h-full min-w-0 flex-1 ${connecting ? 'ds-connecting' : ''}`} onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onMoveStart={(e) => { if (e) userMoved.current = true; }}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onDelete={({ nodes: ns, edges: es }) => actions.remove(ns.map((n) => n.id), es.map((e) => e.id))}
        onNodeDoubleClick={(_, n) => {
          const node = useDesignStore.getState().design.nodes.find((x) => x.id === n.id);
          const ui = useStudioUi.getState();
          if (node?.type === 'mysql') ui.openSchema();
          else if (node?.type === 'users') ui.openWorkload();
          else actions.configure(n.id);
        }}
        connectionLineType={ConnectionLineType.SmoothStep}
        snapToGrid
        snapGrid={[16, 16]}
        minZoom={0.3}
        maxZoom={1.5}
        fitView
        fitViewOptions={FIT}
        deleteKeyCode={['Delete', 'Backspace']}
        zoomOnDoubleClick={false}
        className="!bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--grid-dot)" />
        <Controls showInteractive={false} position="bottom-left" onFitView={() => { userMoved.current = false; }} />
        {viewportH >= MINIMAP_MIN_VIEWPORT_H && (
          <MiniMap pannable zoomable position="bottom-right" nodeColor="var(--mm-node)" nodeStrokeWidth={0} bgColor="var(--surface)" maskColor="var(--mm-mask)" style={{ width: 160, height: 100 }} />
        )}
        <Panel position="top-left" className="flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5">
          <IconButton size="sm" label="Undo" shortcut="Ctrl+Z" icon={<Undo2 size={14} />} disabled={pastLen === 0} onClick={actions.undo} />
          <IconButton size="sm" label="Redo" shortcut="Ctrl+Shift+Z" icon={<Redo2 size={14} />} disabled={futureLen === 0} onClick={actions.redo} />
          <span className="mx-0.5 h-4 w-px bg-line" />
          <IconButton size="sm" label="Auto layout" icon={<Workflow size={14} />} onClick={() => { userMoved.current = false; actions.layout(); }} disabled={design.nodes.length === 0} />
        </Panel>
      </ReactFlow>
      {hint && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-6">
          <div className="ds-fade-in max-w-[420px] rounded-lg border border-line bg-surface/95 px-3 py-2 text-center text-xs text-muted">
            {hint.title && <div className="mb-0.5 text-sm font-medium text-fg">{hint.title}</div>}
            {hint.text}
          </div>
        </div>
      )}
    </div>
  );
}
