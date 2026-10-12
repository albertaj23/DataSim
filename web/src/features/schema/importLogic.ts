import type { SchemaModel, Table } from '@datasim/shared';
import { layoutTables, TABLE_W } from './layout';

export interface MergeResult { skipped: string[]; added: string[] }

/**
 * Applies an imported schema to `target`.
 * replace: the imported tables become the schema. add: tables whose name already exists are skipped.
 * Imported positions are discarded and laid out left to right; added tables start to the right of what is already placed.
 */
export function mergeImported(target: SchemaModel, imported: SchemaModel, mode: 'replace' | 'add'): MergeResult {
  const incoming: Table[] = imported.tables.map((t) => ({ ...structuredClone(t), position: undefined }));
  if (mode === 'replace') {
    const pos = layoutTables({ tables: incoming });
    target.tables = incoming.map((t) => ({ ...t, position: pos[t.name] }));
    return { skipped: [], added: incoming.map((t) => t.name) };
  }
  const have = new Set(target.tables.map((t) => t.name));
  const fresh = incoming.filter((t) => !have.has(t.name));
  const skipped = incoming.filter((t) => have.has(t.name)).map((t) => t.name);
  const pos = layoutTables({ tables: fresh });
  const startX = target.tables.reduce((m, t) => Math.max(m, (t.position?.x ?? 0) + TABLE_W), 0) + (target.tables.length ? 110 : 0);
  for (const t of fresh) target.tables.push({ ...t, position: { x: (pos[t.name]?.x ?? 0) + startX, y: pos[t.name]?.y ?? 0 } });
  return { skipped, added: fresh.map((t) => t.name) };
}
