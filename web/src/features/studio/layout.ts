import dagre from '@dagrejs/dagre';
import type { DesignDoc, NodeType } from '@datasim/shared';
import { snap } from './nodes';

export const NODE_W = 248;
export const NODE_H = 64;

const TYPE_ORDER: Record<NodeType, number> = { users: 0, lb: 1, app: 2, redis: 3, mysql: 3 };

/** Left-to-right dagre layout. Returns top-left positions snapped to the 16px grid. */
export function autoLayout(design: Pick<DesignDoc, 'nodes' | 'edges'>): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  if (design.nodes.length === 0) return out;

  // Without links dagre would stack everything in one column; fall back to type columns.
  if (design.edges.length === 0) {
    const rows: Record<number, number> = {};
    for (const n of [...design.nodes].sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type])) {
      const col = TYPE_ORDER[n.type];
      const row = rows[col] ?? 0; rows[col] = row + 1;
      out[n.id] = { x: snap(col * (NODE_W + 56)), y: snap(row * (NODE_H + 32)) };
    }
    return out;
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 48, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of design.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of design.edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  dagre.layout(g);
  for (const n of design.nodes) {
    const p = g.node(n.id);
    out[n.id] = { x: snap(p.x - NODE_W / 2), y: snap(p.y - NODE_H / 2) };
  }
  return out;
}
