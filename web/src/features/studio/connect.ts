import { canConnect, type DesignDoc } from '@datasim/shared';

export type ConnectResult = { ok: true } | { ok: false; reason: string };

/** Connection rules enforced while dragging (isValidConnection) and again on drop (toast with the reason). */
export function checkConnection(design: Pick<DesignDoc, 'nodes' | 'edges'>, source: string | null | undefined, target: string | null | undefined): ConnectResult {
  const s = design.nodes.find((n) => n.id === source);
  const t = design.nodes.find((n) => n.id === target);
  if (!s || !t) return { ok: false, reason: 'Unknown node' };
  if (s.id === t.id) return { ok: false, reason: 'A node cannot connect to itself' };
  const rule = canConnect(s.type, t.type);
  if (!rule.ok) return rule;
  if (design.edges.some((e) => e.source === s.id && e.target === t.id)) return { ok: false, reason: `${s.name} is already connected to ${t.name}` };
  return { ok: true };
}

/**
 * A connection drag released over a node (anywhere on it, not just on a handle). `fromType` is the handle type the drag
 * started from: dragging from a target handle reverses the link. Null when released over nothing or over the origin node.
 */
export function resolveDrop(
  design: Pick<DesignDoc, 'nodes' | 'edges'>, fromId: string | null | undefined, fromType: 'source' | 'target' | null | undefined, toId: string | null | undefined,
): { source: string; target: string; result: ConnectResult } | null {
  if (!fromId || !toId || fromId === toId) return null;
  const [source, target] = fromType === 'target' ? [toId, fromId] : [fromId, toId];
  return { source, target, result: checkConnection(design, source, target) };
}

/** Ids of nodes that cannot be the other end of a link started at `fromId` (dimmed while dragging). */
export function invalidTargets(design: Pick<DesignDoc, 'nodes' | 'edges'>, fromId: string, fromType: 'source' | 'target' | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const n of design.nodes) if (n.id !== fromId && !resolveDrop(design, fromId, fromType, n.id)!.result.ok) out.add(n.id);
  return out;
}
