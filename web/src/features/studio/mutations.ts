// Pure draft mutators used with `useDesignStore.getState().update(draft => ...)`.
import type { DesignDoc, DesignNode, StrategyVariant, Isolation } from '@datasim/shared';

type ConfigOf<T extends DesignNode['type']> = Extract<DesignNode, { type: T }>['config'];

/** Merge `patch` into a node's config (only if the node has that type). */
export function patchConfig<T extends DesignNode['type']>(draft: DesignDoc, id: string, type: T, patch: Partial<ConfigOf<T>>): void {
  const n = draft.nodes.find((x) => x.id === id);
  if (n && n.type === type) Object.assign(n.config, patch);
}

export function renameNode(draft: DesignDoc, id: string, name: string): void {
  const n = draft.nodes.find((x) => x.id === id);
  const trimmed = name.trim().slice(0, 60);
  if (n && trimmed) n.name = trimmed;
}

export function patchEdge(draft: DesignDoc, id: string, patch: { latencyMs?: number; jitterMs?: number }): void {
  const e = draft.edges.find((x) => x.id === id);
  if (e) Object.assign(e, patch);
}

/** Quick selector: the strategy lives on every App node. */
export function setStrategy(draft: DesignDoc, strategy: StrategyVariant): void {
  for (const n of draft.nodes) if (n.type === 'app') n.config.strategy = strategy;
}
export function setIsolation(draft: DesignDoc, isolation: Isolation): void {
  for (const n of draft.nodes) if (n.type === 'mysql') n.config.isolation = isolation;
}
export const currentStrategy = (d: Pick<DesignDoc, 'nodes'>): StrategyVariant | null => {
  const a = d.nodes.find((n) => n.type === 'app');
  return a?.type === 'app' ? a.config.strategy : null;
};
export const currentIsolation = (d: Pick<DesignDoc, 'nodes'>): Isolation | null => {
  const m = d.nodes.find((n) => n.type === 'mysql');
  return m?.type === 'mysql' ? m.config.isolation : null;
};

/** Table/row/index summary for the DB inspector. */
export function schemaSummary(design: Pick<DesignDoc, 'schema'>): { tables: number; rows: number; indexes: number } {
  const t = design.schema.tables;
  return {
    tables: t.length,
    rows: t.reduce((s, x) => s + x.seedRows, 0),
    // secondary indexes + unique constraints (the engine builds an index for each)
    indexes: t.reduce((s, x) => s + x.indexes.length + x.uniques.length, 0),
  };
}

/** Workload summary for the Users inspector: transaction names with normalised mix percentages. */
export function workloadSummary(design: Pick<DesignDoc, 'workload'>): { name: string; pct: number; readOnly: boolean }[] {
  const tx = design.workload.transactions;
  const total = tx.reduce((s, t) => s + t.weight, 0);
  return tx.map((t) => ({ name: t.name, pct: total > 0 ? Math.round((t.weight / total) * 100) : 0, readOnly: t.readOnly }));
}
