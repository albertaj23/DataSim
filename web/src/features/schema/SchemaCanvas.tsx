import {
  applyNodeChanges, Background, BackgroundVariant, ConnectionMode, Controls, MiniMap, ReactFlow, useReactFlow,
  type Connection, type Edge, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Table } from '@datasim/shared';
import { useDesignStore } from '../../lib/designStore';
import { fkEdges } from './logic';
import { layoutTables, TABLE_W } from './layout';
import { FkMarkers, TableNode, type TableFlowNode } from './TableNode';

const nodeTypes = { table: TableNode };

export interface SchemaCanvasProps {
  tables: Table[];
  selected: string | null;
  onSelect: (name: string | null) => void;
  /** Severity per table (validation) and the table a failed provision pointed at. */
  problemByTable: Map<string, 'error' | 'warning'>;
  failedTable: string | null;
  onConnect: (child: string, childCol: string, parent: string, parentCol: string) => void;
  /** Bumped by the parent to ask for a re-fit after auto layout. */
  fitToken: number;
  /** Table to center after being added. */
  focusRequest: { name: string; token: number } | null;
}

const colOf = (handle: string | null | undefined) => (handle ?? '').split(':')[0] ?? '';

export function SchemaCanvas({ tables, selected, onSelect, problemByTable, failedTable, onConnect, fitToken, focusRequest }: SchemaCanvasProps) {
  const rf = useReactFlow();
  const update = useDesignStore((s) => s.update);

  // Tables without a saved position get a layered layout; the same positions are committed once so they stay put.
  const fallback = useMemo(() => (tables.some((t) => !t.position) ? layoutTables({ tables }) : {}), [tables]);
  const needsCommit = tables.some((t) => !t.position);
  useEffect(() => {
    if (!needsCommit) return;
    update((d) => { for (const t of d.schema.tables) if (!t.position) t.position = fallback[t.name] ?? { x: 0, y: 0 }; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCommit]);

  const build = useCallback((): TableFlowNode[] => tables.map((t) => ({
    id: t.name,
    type: 'table',
    position: t.position ?? fallback[t.name] ?? { x: 0, y: 0 },
    data: { table: t, problem: problemByTable.get(t.name) ?? null, failed: failedTable === t.name },
    selected: t.name === selected,
    draggable: true,
  })), [tables, fallback, selected, problemByTable, failedTable]);

  const [nodes, setNodes] = useState<TableFlowNode[]>(build);
  useEffect(() => setNodes(build()), [build]);

  const onNodesChange = useCallback((changes: NodeChange<TableFlowNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);

  const edges = useMemo<Edge[]>(() => {
    const pos = new Map(nodes.map((n) => [n.id, n.position]));
    return fkEdges({ tables }).map((e) => {
      const a = pos.get(e.from); const b = pos.get(e.to);
      const dx = a && b ? a.x - b.x : 1;
      // Child left of parent: child right -> parent left. Child right of parent: mirrored. Overlapping columns: loop out of the right side.
      const [sSide, tSide] = Math.abs(dx) < TABLE_W + 24 ? ['r', 'r'] : dx < 0 ? ['r', 'l'] : ['l', 'r'];
      const active = selected === e.from || selected === e.to;
      return {
        id: e.id, source: e.from, target: e.to,
        sourceHandle: `${e.fromCol}:${sSide}`, targetHandle: `${e.toCol}:${tSide}`,
        type: 'smoothstep',
        pathOptions: { borderRadius: 8 },
        markerStart: e.childIsOne ? 'ds-fk-one' : 'ds-fk-many',
        markerEnd: 'ds-fk-one',
        style: { stroke: active ? 'var(--accent)' : 'var(--line-strong)', strokeWidth: active ? 1.5 : 1.25 },
        zIndex: active ? 10 : 0,
        interactionWidth: 14,
        ariaLabel: `${e.from} references ${e.to}: ${e.label}`,
      } as Edge;
    });
  }, [tables, nodes, selected]);

  // Persist drag results as a single undo step.
  const onNodeDragStop = useCallback((_: unknown, __: unknown, dragged: TableFlowNode[]) => {
    update((d) => {
      for (const n of dragged) {
        const t = d.schema.tables.find((x) => x.name === n.id);
        if (t) t.position = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      }
    });
  }, [update]);

  const handleConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return;
    onConnect(c.source, colOf(c.sourceHandle), c.target, colOf(c.targetHandle));
  }, [onConnect]);

  // Re-fit after auto layout; center a freshly added table.
  const lastFit = useRef(fitToken);
  useEffect(() => {
    if (fitToken === lastFit.current) return;
    lastFit.current = fitToken;
    const id = requestAnimationFrame(() => rf.fitView({ padding: 0.15, maxZoom: 1, duration: 220 }));
    return () => cancelAnimationFrame(id);
  }, [fitToken, rf]);
  const lastFocus = useRef(focusRequest?.token);
  useEffect(() => {
    if (!focusRequest || focusRequest.token === lastFocus.current) return;
    lastFocus.current = focusRequest.token;
    const id = requestAnimationFrame(() => rf.fitView({ nodes: [{ id: focusRequest.name }], padding: 1.2, maxZoom: 1, duration: 220 }));
    return () => cancelAnimationFrame(id);
  }, [focusRequest, rf]);

  return (
    <div className="relative h-full w-full bg-bg">
      <FkMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={onNodeDragStop}
        onConnect={handleConnect}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
        snapToGrid
        snapGrid={[8, 8]}
        deleteKeyCode={null}
        nodesConnectable
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--grid-dot)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor="var(--surface-3)" nodeStrokeColor="var(--line-strong)" maskColor="rgb(0 0 0 / 0.45)" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8 }} />
      </ReactFlow>
    </div>
  );
}
