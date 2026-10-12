// Pure node helpers for the Studio: defaults, limits, naming, pills. No React, no store imports (testable in node).
import {
  AppConfig, ISOLATIONS, LbConfig, MysqlConfig, NODE_LIMITS, RedisConfig, STRATEGY_VARIANTS, UsersConfig,
  type DesignDoc, type DesignEdge, type DesignNode, type NodeType,
} from '@datasim/shared';

export interface NodeMeta { label: string; /** Lowercase tag under the icon tile. */ tag: string; blurb: string; group: 'Traffic' | 'Compute' | 'Data' }
export const NODE_META: Record<NodeType, NodeMeta> = {
  users: { label: 'Users', tag: 'users', blurb: 'Virtual users and workload', group: 'Traffic' },
  lb: { label: 'Load balancer', tag: 'lb', blurb: 'Spreads traffic over apps', group: 'Traffic' },
  app: { label: 'App server', tag: 'app', blurb: 'Workers, pool and retries', group: 'Compute' },
  redis: { label: 'Cache', tag: 'redis', blurb: 'Redis cache-aside reads', group: 'Data' },
  mysql: { label: 'Database', tag: 'mysql', blurb: 'MySQL 8.4 · InnoDB', group: 'Data' },
};
export const PALETTE_GROUPS: { group: NodeMeta['group']; types: NodeType[] }[] = [
  { group: 'Traffic', types: ['users', 'lb'] },
  { group: 'Compute', types: ['app'] },
  { group: 'Data', types: ['redis', 'mysql'] },
];

const STRATEGY_HINT: Record<string, string> = {
  default: 'as written', naive: 'read, then write', pessimistic: 'FOR UPDATE', optimistic: 'version check', atomic: 'single UPDATE', serializable: 'SERIALIZABLE',
};
export const STRATEGY_OPTIONS = STRATEGY_VARIANTS.map((v) => ({ value: v, label: v, hint: STRATEGY_HINT[v] }));
export const ISOLATION_OPTIONS = ISOLATIONS.map((v) => ({ value: v, label: v }));

export const ISOLATION_SHORT: Record<string, string> = { 'READ UNCOMMITTED': 'RU', 'READ COMMITTED': 'RC', 'REPEATABLE READ': 'RR', SERIALIZABLE: 'SER' };

/** Config defaults come from the shared zod schemas, so they can never drift from the server. */
export function defaultConfig(type: NodeType): DesignNode['config'] {
  switch (type) {
    case 'users': return UsersConfig.parse({});
    case 'lb': return LbConfig.parse({});
    case 'app': return AppConfig.parse({});
    case 'redis': return RedisConfig.parse({});
    case 'mysql': return MysqlConfig.parse({});
  }
}

export const countOf = (design: Pick<DesignDoc, 'nodes'>, type: NodeType) => design.nodes.filter((n) => n.type === type).length;

export function canAddNode(design: Pick<DesignDoc, 'nodes'>, type: NodeType): { ok: true } | { ok: false; reason: string } {
  const limit = NODE_LIMITS[type];
  if (countOf(design, type) >= limit) {
    return { ok: false, reason: `At most ${limit} ${NODE_META[type].label.toLowerCase()}${limit === 1 ? '' : 's'} per design` };
  }
  return { ok: true };
}

/** "App server", "App server 2", ... first name not already used. */
export function uniqueName(design: Pick<DesignDoc, 'nodes'>, base: string): string {
  const used = new Set(design.nodes.map((n) => n.name));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

const rand = () => Math.random().toString(36).slice(2, 8);
export function uniqueId(design: Pick<DesignDoc, 'nodes'>, type: NodeType, gen: () => string = rand): string {
  const used = new Set(design.nodes.map((n) => n.id));
  let id = `${type}_${gen()}`;
  while (used.has(id)) id = `${type}_${gen()}`;
  return id;
}

// Left-to-right layout columns, so a click-added node lands where it would be wired.
const COL_X: Record<NodeType, number> = { users: 0, lb: 304, app: 608, redis: 912, mysql: 912 };
export const GRID = 16;
export const snap = (v: number) => Math.round(v / GRID) * GRID;

/** Next free spot for a click-added node: its type's column, below whatever is already there. */
export function suggestPosition(design: Pick<DesignDoc, 'nodes'>, type: NodeType): { x: number; y: number } {
  const x = COL_X[type];
  const inCol = design.nodes.filter((n) => Math.abs(n.position.x - x) < 120);
  const y = inCol.length ? Math.max(...inCol.map((n) => n.position.y)) + 96 : 0;
  return { x, y: snap(y) };
}

/** Mutates `draft`. Returns the new node, or the reason it could not be added. */
export function addNode(draft: DesignDoc, type: NodeType, position?: { x: number; y: number }): { ok: true; node: DesignNode } | { ok: false; reason: string } {
  const can = canAddNode(draft, type);
  if (!can.ok) return can;
  const p = position ?? suggestPosition(draft, type);
  const node = {
    id: uniqueId(draft, type), type, name: uniqueName(draft, NODE_META[type].label),
    position: { x: snap(p.x), y: snap(p.y) }, config: defaultConfig(type),
  } as DesignNode;
  draft.nodes.push(node);
  return { ok: true, node };
}

/** Mutates `draft`. Copy gets a fresh id/name, offset position, and no edges. */
export function duplicateNode(draft: DesignDoc, id: string): { ok: true; node: DesignNode } | { ok: false; reason: string } {
  const src = draft.nodes.find((n) => n.id === id);
  if (!src) return { ok: false, reason: 'Node not found' };
  const can = canAddNode(draft, src.type);
  if (!can.ok) return can;
  const copy = {
    ...structuredClone(src), id: uniqueId(draft, src.type),
    name: uniqueName(draft, src.name.replace(/ \d+$/, '')),
    position: { x: snap(src.position.x + 48), y: snap(src.position.y + 96) },
  } as DesignNode;
  draft.nodes.push(copy);
  return { ok: true, node: copy };
}

/** Mutates `draft`: removes nodes and every edge touching them (plus any explicit edge ids). */
export function removeItems(draft: DesignDoc, nodeIds: string[], edgeIds: string[] = []): void {
  const ns = new Set(nodeIds); const es = new Set(edgeIds);
  draft.nodes = draft.nodes.filter((n) => !ns.has(n.id));
  draft.edges = draft.edges.filter((e) => !es.has(e.id) && !ns.has(e.source) && !ns.has(e.target));
}

export function newEdge(draft: Pick<DesignDoc, 'edges'>, source: string, target: string): DesignEdge {
  const base = `e_${source}_${target}`;
  let id = base;
  for (let i = 2; draft.edges.some((e) => e.id === id); i++) id = `${base}_${i}`;
  return { id, source, target, latencyMs: 1, jitterMs: 0 };
}

// ---------------------------------------------------------------- pills
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');

/** Config pills shown on a card at rest. */
export function configPills(node: DesignNode): string[] {
  switch (node.type) {
    case 'users': return [`${n0(node.config.vus)} VUs`];
    case 'lb': return [node.config.algorithm === 'round-robin' ? 'RR' : 'LC'];
    case 'app': return [`${node.config.instances}× pool ${node.config.poolSize}`];
    case 'redis': return [`ttl ${node.config.ttlS}s`];
    case 'mysql': return [ISOLATION_SHORT[node.config.isolation] ?? node.config.isolation, `lwt ${node.config.lockWaitTimeoutS}s`];
  }
}

export interface LivePill { text: string; tone?: 'neutral' | 'amber' | 'red' | 'green' }
/** Live metric pills (keys come from RunSample.nodes[nodeId], see engine/load.ts). Empty when nothing arrived yet. */
export function livePills(type: NodeType, m: Record<string, number> | undefined): LivePill[] {
  if (!m) return [];
  const out: LivePill[] = [];
  const has = (k: string) => typeof m[k] === 'number' && Number.isFinite(m[k]);
  switch (type) {
    case 'users':
      if (has('vus')) out.push({ text: `${n0(m.vus!)} VUs` });
      if (has('tps')) out.push({ text: `${n0(m.tps!)} tps` });
      break;
    case 'lb':
      if (has('tps')) out.push({ text: `${n0(m.tps!)} tps` });
      break;
    case 'app':
      if (has('tps')) out.push({ text: `${n0(m.tps!)} tps` });
      if (has('p95')) out.push({ text: `p95 ${n0(m.p95!)}ms` });
      if (has('pool') && has('poolMax')) out.push(m.pool! >= m.poolMax! ? { text: `pool ${m.pool}/${m.poolMax}`, tone: 'amber' } : { text: `pool ${m.pool}/${m.poolMax}` });
      break;
    case 'redis':
      if (has('hit')) out.push(m.hit! < 0.5 ? { text: `hit ${Math.round(m.hit! * 100)}%`, tone: 'amber' } : { text: `hit ${Math.round(m.hit! * 100)}%` });
      else if (has('ops')) out.push({ text: `${n0(m.ops!)} ops` });
      break;
    case 'mysql':
      if (has('tps')) out.push({ text: `${n0(m.tps!)} tps` });
      if (has('threads')) out.push({ text: `thr ${n0(m.threads!)}` });
      if (has('lockWaits') && m.lockWaits! > 0) out.push({ text: `lw ${n0(m.lockWaits!)}`, tone: 'amber' });
      if (has('violations') && m.violations! > 0) out.push({ text: `viol ${n0(m.violations!)}`, tone: 'red' });
      break;
  }
  return out;
}

/** Subtitle under the node title: the one setting that matters for the demo. */
export function nodeSubtitle(node: DesignNode): string {
  switch (node.type) {
    case 'users': return `${node.config.pattern} · ${node.config.durationS}s`;
    case 'lb': return node.config.algorithm;
    case 'app': return `strategy ${node.config.strategy}`;
    case 'redis': return 'cache-aside';
    case 'mysql': return 'MySQL 8.4 · InnoDB';
  }
}

/** Edge flow rate for animated dots: the throughput the target node reports, falling back to the source's. */
export function edgeFlow(e: Pick<DesignEdge, 'source' | 'target'>, nodes: Record<string, Record<string, number>> | undefined): number {
  if (!nodes) return 0;
  const t = nodes[e.target]; const s = nodes[e.source];
  const v = t?.tps ?? t?.ops ?? s?.tps ?? 0;
  return Number.isFinite(v) ? v : 0;
}

/** Number of dots on an edge: proportional to throughput, 0 when idle, capped. */
export function dotCount(tps: number, perDot = 120, cap = 6): number {
  if (!(tps > 0)) return 0;
  return Math.min(cap, Math.max(1, Math.round(tps / perDot)));
}
