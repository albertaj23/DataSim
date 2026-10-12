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
