// Value-generator factories and text <-> value parsing, shared by the seed form (Schema Designer) and the params table (Workload Editor).
import { previewGenerator, type Column, type SchemaModel, type Table, type ValueGenerator } from '@datasim/shared';

export type GenKind = ValueGenerator['kind'];

export const GEN_LABELS: Record<GenKind, string> = {
  sequence: 'Sequence', uniformInt: 'Uniform int', normalInt: 'Normal int', zipf: 'Zipf', decimalRange: 'Decimal range', pickList: 'Pick list',
  personName: 'Person name', email: 'Email', pattern: 'Pattern', dateRange: 'Date range', constant: 'Constant', fkRef: 'FK reference',
  expression: 'Expression', fromTable: 'From table',
};

/** Seed generators: everything except `fromTable` (workload params only). */
export const SEED_KINDS: GenKind[] = ['sequence', 'uniformInt', 'normalInt', 'zipf', 'decimalRange', 'pickList', 'personName', 'email', 'pattern', 'dateRange', 'constant', 'fkRef', 'expression'];
/** Param generators: no `fkRef` (needs a row being seeded) and no `expression` (needs sibling columns). */
export const PARAM_KINDS: GenKind[] = ['fromTable', 'uniformInt', 'zipf', 'normalInt', 'sequence', 'decimalRange', 'pickList', 'personName', 'email', 'pattern', 'dateRange', 'constant'];

/** A sensible starting generator for a kind. `ref` seeds the table/column of fkRef/fromTable. */
export function defaultGenerator(kind: GenKind, ref?: { table: string; column: string }): ValueGenerator {
  switch (kind) {
    case 'sequence': return { kind, start: 1, step: 1 };
    case 'uniformInt': return { kind, min: 1, max: 100 };
    case 'normalInt': return { kind, mean: 50, stddev: 10 };
    case 'zipf': return { kind, n: 100, s: 1.1, min: 1 };
    case 'decimalRange': return { kind, min: 0, max: 100, scale: 2 };
    case 'pickList': return { kind, values: ['a', 'b', 'c'] };
    case 'personName': return { kind };
    case 'email': return { kind, domain: 'example.edu' };
    case 'pattern': return { kind, pattern: '24BCE####', mode: 'sequential' };
    case 'dateRange': return { kind, from: '2024-01-01', to: '2025-12-31' };
    case 'constant': return { kind, value: 0 };
    case 'fkRef': return { kind, table: ref?.table ?? 'parent', column: ref?.column ?? 'id', dist: 'uniform', s: 1.1 };
    case 'fromTable': return { kind, table: ref?.table ?? 'parent', column: ref?.column ?? 'id', dist: 'uniform', s: 1.1 };
    case 'expression': return { kind, expr: '1' };
  }
}

/** The key column a new fkRef/fromTable generator should point at: the column's own FK parent, else the first table's PK. */
export function refFor(schema: SchemaModel, table?: Table, column?: string): { table: string; column: string } | undefined {
  const fk = table?.foreignKeys.find((f) => column !== undefined && f.columns.length === 1 && f.columns[0] === column);
  if (fk) return { table: fk.refTable, column: fk.refColumns[0]! };
  const t = schema.tables.find((x) => x.name !== table?.name) ?? schema.tables[0];
  return t ? { table: t.name, column: t.primaryKey[0] ?? t.columns[0]!.name } : undefined;
}

// ---------------------------------------------------------------- text <-> values
const NUM = /^-?\d+(\.\d+)?$/;
const scalar = (s: string): string | number => (NUM.test(s) ? Number(s) : s);

/** "a, b, 3" -> ['a','b',3]. */
export function parseList(text: string): Array<string | number> {
  return text.split(',').map((s) => s.trim()).filter((s) => s !== '').map(scalar);
}
export const formatList = (v: ReadonlyArray<string | number>) => v.join(', ');

export function parseWeights(text: string): number[] | undefined {
  const w = text.split(',').map((s) => s.trim()).filter((s) => s !== '').map(Number);
  return w.length && w.every((n) => Number.isFinite(n) && n > 0) ? w : undefined;
}

/** `null`, `true`, `false`, numbers and strings. */
export function parseConstant(text: string): string | number | boolean | null {
  const s = text.trim();
  if (s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  return NUM.test(s) ? Number(s) : text;
}
export const formatConstant = (v: string | number | boolean | null) => (v === null ? 'null' : String(v));

/** Empty -> undefined, otherwise a finite number (NaN -> undefined). */
export function parseOptionalNumber(text: string): number | undefined {
  const s = text.trim();
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Problem text for a generator's arguments, or null. */
export function generatorError(g: ValueGenerator): string | null {
  switch (g.kind) {
    case 'uniformInt': case 'decimalRange': return g.min > g.max ? 'min must be at most max' : null;
    case 'normalInt': return g.min !== undefined && g.max !== undefined && g.min > g.max ? 'min must be at most max' : null;
    case 'pickList': return g.weights && g.weights.length !== g.values.length ? `${g.weights.length} weights for ${g.values.length} values` : null;
    case 'dateRange': return Number.isNaN(Date.parse(g.from)) || Number.isNaN(Date.parse(g.to)) ? 'Use dates like 2024-01-31' : Date.parse(g.from) > Date.parse(g.to) ? 'from must be before to' : null;
    case 'pattern': return g.pattern.includes('#') || g.pattern.includes('@') ? null : 'Use # for digits and @ for letters';
    default: return null;
  }
}

/** Five sample values, rendered as short strings. Generators that need other data show what they would draw from. */
export function sampleStrings(g: ValueGenerator, seed = 1, n = 5): string[] {
  try {
    return previewGenerator(g, n, seed).map((v) => (v === null ? 'NULL' : String(v)));
  } catch (e) {
    return [`error: ${(e as Error).message}`];
  }
}

/** Inferred-seed hint for a column that has no explicit generator. */
export function inferredSeedLabel(c: Column): string {
  if (c.generated) return 'generated by MySQL';
  if (c.autoIncrement) return 'auto-increment';
  return 'inferred from the column type';
}
