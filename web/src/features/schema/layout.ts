import dagre from '@dagrejs/dagre';
import { columnTypeSql, type ColumnType, type SchemaModel, type Table } from '@datasim/shared';

export const TABLE_W = 248;
export const HEADER_H = 36;
export const ROW_H = 24;
export const tableHeight = (t: Table) => HEADER_H + t.columns.length * ROW_H + 6;

/** Left-to-right layered layout: referenced (parent) tables on the left, children on the right. Returns top-left corners. */
export function layoutTables(schema: SchemaModel): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 72, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  const names = new Set(schema.tables.map((t) => t.name));
  for (const t of schema.tables) g.setNode(t.name, { width: TABLE_W, height: tableHeight(t) });
  for (const t of schema.tables) for (const fk of t.foreignKeys) if (fk.refTable !== t.name && names.has(fk.refTable)) g.setEdge(fk.refTable, t.name);
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  for (const t of schema.tables) {
    const n = g.node(t.name);
    out[t.name] = { x: Math.round(n.x - TABLE_W / 2), y: Math.round(n.y - tableHeight(t) / 2) };
  }
  return out;
}

/** Short type label for a node row: VARCHAR(80), DECIMAL(10,2), INT UNSIGNED -> INT+, ENUM(3). */
export function typeLabel(t: ColumnType): string {
  if (t.kind === 'ENUM') return `ENUM(${t.values.length})`;
  const s = columnTypeSql(t);
  return s.replace(' UNSIGNED', ' U');
}

/** Moves a proposed top-left position down until it no longer overlaps an existing table. */
export function freeSpot(pos: { x: number; y: number }, tables: Table[]): { x: number; y: number } {
  const snap = (n: number) => Math.round(n / 8) * 8;
  let p = { x: snap(pos.x), y: snap(pos.y) };
  const hits = (q: { x: number; y: number }) => tables.some((t) => t.position && Math.abs(t.position.x - q.x) < TABLE_W + 16 && q.y < t.position.y + tableHeight(t) + 16 && t.position.y < q.y + 150);
  for (let i = 0; i < 40 && hits(p); i++) p = { x: p.x, y: p.y + 40 };
  return p;
}
