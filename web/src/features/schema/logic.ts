// Pure schema-editing logic (no React). Every mutator edits a draft in place, so it is meant to be called
// inside `useDesignStore.getState().update(draft => ...)` and is unit-tested on structuredClone copies.
import { IDENT_RE, type Column, type ColumnType, type DesignDoc, type Problem, type SchemaModel, type Table } from '@datasim/shared';

export type Kind = ColumnType['kind'];
export const INT_KINDS: readonly Kind[] = ['TINYINT', 'SMALLINT', 'INT', 'BIGINT'];
export const isIntKind = (k: Kind) => INT_KINDS.includes(k);

/** Message for an invalid identifier, else null. `taken` are the other names in the same scope. */
export function identError(name: string, taken: readonly string[] = []): string | null {
  if (!name) return 'Required';
  if (name.length > 64) return 'At most 64 characters';
  if (!IDENT_RE.test(name)) return 'Lowercase letters, digits and _; must start with a letter';
  if (taken.includes(name)) return 'Already used';
  return null;
}

/** `base`, else `base_2`, `base_3`, ... */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function defaultType(kind: Kind): ColumnType {
  switch (kind) {
    case 'TINYINT': case 'SMALLINT': case 'INT': case 'BIGINT': return { kind, unsigned: false };
    case 'DECIMAL': return { kind, precision: 10, scale: 2 };
    case 'CHAR': return { kind, length: 8 };
    case 'VARCHAR': return { kind, length: 64 };
    case 'ENUM': return { kind, values: ['a', 'b'] };
    default: return { kind } as ColumnType;
  }
}

/** Switches a column to another type kind, keeping what carries over (length, unsigned) and dropping what no longer applies. */
export function setColumnKind(c: Column, kind: Kind): void {
  const prev = c.type;
  const next = defaultType(kind);
  if (isIntKind(prev.kind) && isIntKind(kind)) (next as { unsigned: boolean }).unsigned = (prev as { unsigned: boolean }).unsigned;
  if ((prev.kind === 'CHAR' || prev.kind === 'VARCHAR') && (kind === 'CHAR' || kind === 'VARCHAR')) (next as { length: number }).length = (prev as { length: number }).length;
  c.type = next;
  if (!isIntKind(kind)) c.autoIncrement = false;
  if (prev.kind !== kind) c.default = undefined;
}

export function newColumn(t: Table): Column {
  return { name: uniqueName('column', t.columns.map((c) => c.name)), type: defaultType('VARCHAR'), nullable: true, autoIncrement: false };
}

export function newTable(schema: SchemaModel, position?: { x: number; y: number }): Table {
  return {
    name: uniqueName('new_table', schema.tables.map((t) => t.name)),
    columns: [{ name: 'id', type: defaultType('INT'), nullable: false, autoIncrement: true }],
    primaryKey: ['id'], uniques: [], indexes: [], foreignKeys: [], checks: [], seedRows: 100, position,
  };
}

// ---------------------------------------------------------------- identifier rewriting in SQL-ish text
const TOKEN = /'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"|`[^`]*`|[A-Za-z_][A-Za-z0-9_]*/g;

/** Renames identifier tokens (bare or backticked) outside string literals. */
export function replaceIdent(sql: string, from: string, to: string): string {
  return sql.replace(TOKEN, (tok) => {
    if (tok === from) return to;
    if (tok === `\`${from}\``) return `\`${to}\``;
    return tok;
  });
}

/** Number of identifier tokens equal to `name` outside string literals. */
export function countIdent(sql: string, name: string): number {
  let n = 0;
  for (const m of sql.matchAll(TOKEN)) if (m[0] === name || m[0] === `\`${name}\``) n++;
  return n;
}

/** Workload statements (steps and invariants) that mention an identifier. Used to warn after a rename/delete: SQL is never rewritten automatically. */
export function sqlMentions(design: DesignDoc, name: string): number {
  let n = 0;
  for (const t of design.workload.transactions) for (const steps of Object.values(t.variants)) for (const s of steps) if (countIdent(s.sql, name) > 0) n++;
  for (const i of design.workload.invariants) if (countIdent(i.sql, name) > 0) n++;
  return n;
}

const mapList = (list: string[], from: string, to: string) => list.map((c) => (c === from ? to : c));

// ---------------------------------------------------------------- rename propagation
export function renameTable(design: DesignDoc, from: string, to: string): void {
  const schema = design.schema;
  for (const t of schema.tables) {
    if (t.name === from) t.name = to;
    for (const fk of t.foreignKeys) if (fk.refTable === from) fk.refTable = to;
    for (const c of t.columns) {
      const s = c.seed;
      if (s && (s.kind === 'fkRef' || s.kind === 'fromTable') && s.table === from) s.table = to;
    }
  }
  for (const txn of design.workload.transactions) {
    for (const g of Object.values(txn.params)) if (g.kind === 'fromTable' && g.table === from) g.table = to;
  }
}

export function renameColumn(design: DesignDoc, table: string, from: string, to: string): void {
  for (const t of design.schema.tables) {
    if (t.name === table) {
      for (const c of t.columns) {
        if (c.name === from) c.name = to;
        if (c.generated) c.generated.expr = replaceIdent(c.generated.expr, from, to);
        const s = c.seed;
        if (s?.kind === 'email' && s.from === from) s.from = to;
        if (s?.kind === 'expression') s.expr = replaceIdent(s.expr, from, to);
      }
      t.primaryKey = mapList(t.primaryKey, from, to);
      for (const u of t.uniques) u.columns = mapList(u.columns, from, to);
      for (const i of t.indexes) i.columns = mapList(i.columns, from, to);
      for (const k of t.checks) k.expr = replaceIdent(k.expr, from, to);
      for (const fk of t.foreignKeys) fk.columns = mapList(fk.columns, from, to);
    }
    for (const fk of t.foreignKeys) if (fk.refTable === table) fk.refColumns = mapList(fk.refColumns, from, to);
    for (const c of t.columns) {
      const s = c.seed;
      if (s && (s.kind === 'fkRef' || s.kind === 'fromTable') && s.table === table && s.column === from) s.column = to;
    }
  }
  for (const txn of design.workload.transactions) {
    for (const g of Object.values(txn.params)) if (g.kind === 'fromTable' && g.table === table && g.column === from) g.column = to;
  }
}

// ---------------------------------------------------------------- delete
const touches = (cols: string[], col: string) => cols.includes(col);

/** Removes a column and everything that depends on it (PK entry, constraints, indexes, FKs on either side, seed refs).
 *  A table that loses its whole primary key gets its first remaining column as the new key. The last column of a table is never deleted. */
export function deleteColumn(design: DesignDoc, table: string, col: string): void {
  if (design.schema.tables.find((t) => t.name === table)?.columns.length === 1) return;
  for (const t of design.schema.tables) {
    if (t.name === table) {
      t.columns = t.columns.filter((c) => c.name !== col);
      t.primaryKey = t.primaryKey.filter((c) => c !== col);
      if (t.primaryKey.length === 0 && t.columns.length > 0) { t.primaryKey = [t.columns[0]!.name]; t.columns[0]!.nullable = false; }
      t.uniques = t.uniques.filter((u) => !touches(u.columns, col));
      t.indexes = t.indexes.filter((i) => !touches(i.columns, col));
      t.foreignKeys = t.foreignKeys.filter((fk) => !touches(fk.columns, col));
      for (const c of t.columns) if (c.seed?.kind === 'email' && c.seed.from === col) c.seed = { ...c.seed, from: undefined };
    }
    t.foreignKeys = t.foreignKeys.filter((fk) => !(fk.refTable === table && touches(fk.refColumns, col)));
    for (const c of t.columns) {
      const s = c.seed;
      if (s && (s.kind === 'fkRef') && s.table === table && s.column === col) c.seed = undefined;
    }
  }
}

export function deleteTable(design: DesignDoc, table: string): void {
  design.schema.tables = design.schema.tables.filter((t) => t.name !== table);
  for (const t of design.schema.tables) {
    t.foreignKeys = t.foreignKeys.filter((fk) => fk.refTable !== table);
    for (const c of t.columns) if (c.seed?.kind === 'fkRef' && c.seed.table === table) c.seed = undefined;
  }
}

// ---------------------------------------------------------------- flags
export const isUniqueCol = (t: Table, col: string) => t.uniques.some((u) => u.columns.length === 1 && u.columns[0] === col);

/** PK membership; adding a column to the key makes it NOT NULL. The last key column cannot be removed (the model needs a PK). */
export function togglePk(t: Table, col: string): void {
  if (t.primaryKey.includes(col)) {
    if (t.primaryKey.length === 1) return; // the model requires a primary key (min 1 column)
    t.primaryKey = t.primaryKey.filter((c) => c !== col);
    const c = t.columns.find((x) => x.name === col);
    if (c) c.autoIncrement = false;
  } else {
    t.primaryKey = [...t.primaryKey, col];
    const c = t.columns.find((x) => x.name === col);
    if (c) c.nullable = false;
  }
}

export function toggleUnique(t: Table, col: string): void {
  if (isUniqueCol(t, col)) t.uniques = t.uniques.filter((u) => !(u.columns.length === 1 && u.columns[0] === col));
  else t.uniques.push({ columns: [col] });
}

/** AUTO_INCREMENT: integer columns only, and the column must be in the key, so it joins the PK when the key is empty. */
export function toggleAutoIncrement(t: Table, col: string): void {
  const c = t.columns.find((x) => x.name === col);
  if (!c || !isIntKind(c.type.kind)) return;
  c.autoIncrement = !c.autoIncrement;
  if (c.autoIncrement) {
    c.nullable = false; c.generated = undefined; c.default = undefined;
    if (!t.primaryKey.includes(col) && t.primaryKey.length === 0) t.primaryKey = [col];
  }
}

// ---------------------------------------------------------------- default values
type DefaultValue = Column['default'];

/** Text -> DEFAULT. Empty = none, `NULL`, `(expr)`, CURRENT_TIMESTAMP, number/boolean per column type, else a string literal. */
export function parseDefault(text: string, type: ColumnType): DefaultValue {
  const s = text.trim();
  if (s === '') return undefined;
  if (/^null$/i.test(s)) return null;
  const paren = s.match(/^\((.+)\)$/);
  if (paren) return { expr: paren[1]! };
  if (/^current_timestamp(\(\d*\))?$/i.test(s)) return { expr: s };
  const numeric = ['TINYINT', 'SMALLINT', 'INT', 'BIGINT', 'DECIMAL', 'FLOAT', 'DOUBLE'].includes(type.kind);
  if (numeric && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (type.kind === 'BOOLEAN') { if (/^(true|1)$/i.test(s)) return true; if (/^(false|0)$/i.test(s)) return false; }
  const quoted = s.match(/^'(.*)'$/s);
  return quoted ? quoted[1]!.replace(/''/g, "'") : s;
}

export function formatDefault(d: DefaultValue): string {
  if (d === undefined) return '';
  if (d === null) return 'NULL';
  if (typeof d === 'object') return /^CURRENT_TIMESTAMP(\(\d*\))?$/i.test(d.expr.trim()) ? d.expr.trim() : `(${d.expr})`;
  return String(d);
}

// ---------------------------------------------------------------- foreign keys / ER edges
export interface FkEdge {
  id: string;
  /** Child table (holds the FK) and the first FK column. */
  from: string; fromCol: string;
  /** Parent table and the first referenced column. */
  to: string; toCol: string;
  /** All column pairs, "a -> b". */
  label: string;
  /** True when the child side is itself unique (one-to-one); otherwise one parent to many children. */
  childIsOne: boolean;
}

export function fkEdges(schema: SchemaModel): FkEdge[] {
  const out: FkEdge[] = [];
  for (const t of schema.tables) {
    t.foreignKeys.forEach((fk, i) => {
      if (!schema.tables.some((p) => p.name === fk.refTable)) return;
      const key = fk.columns.join(',');
      const childIsOne = t.primaryKey.join(',') === key || t.uniques.some((u) => u.columns.join(',') === key) || t.indexes.some((x) => x.unique && x.columns.join(',') === key);
      out.push({
        id: `fk:${t.name}:${i}`, from: t.name, fromCol: fk.columns[0]!, to: fk.refTable, toCol: fk.refColumns[0]!,
        label: fk.columns.map((c, k) => `${c} -> ${fk.refColumns[k] ?? '?'}`).join(', '), childIsOne,
      });
    });
  }
  return out;
}

export const isFkColumn = (t: Table, col: string) => t.foreignKeys.some((fk) => fk.columns.includes(col));

/** True when `cols` of `t` form the PK or a UNIQUE key (so they can be referenced by a foreign key). */
export function isReferenceable(t: Table, cols: string[]): boolean {
  const k = cols.join(',');
  return t.primaryKey.join(',') === k || t.uniques.some((u) => u.columns.join(',') === k) || t.indexes.some((i) => i.unique && i.columns.join(',') === k);
}

/** Adds a single-column FK child.col -> parent.col. Returns an error message when it cannot be created. */
export function addForeignKey(schema: SchemaModel, child: string, col: string, parent: string, parentCol: string): string | null {
  const c = schema.tables.find((t) => t.name === child);
  const p = schema.tables.find((t) => t.name === parent);
  if (!c || !p) return 'Unknown table';
  if (!isReferenceable(p, [parentCol])) return `${parent}.${parentCol} must be a PRIMARY KEY or UNIQUE column to be referenced`;
  if (c.foreignKeys.some((fk) => fk.columns.length === 1 && fk.columns[0] === col && fk.refTable === parent && fk.refColumns[0] === parentCol)) return 'That foreign key already exists';
  c.foreignKeys.push({ columns: [col], refTable: parent, refColumns: [parentCol], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
  return null;
}

/** A new empty FK for the editor: first table/column that makes sense. */
export function newForeignKey(schema: SchemaModel, t: Table): Table['foreignKeys'][number] {
  const target = schema.tables.find((x) => x.name !== t.name) ?? schema.tables[0]!;
  return {
    columns: [t.columns.find((c) => !t.primaryKey.includes(c.name))?.name ?? t.columns[0]!.name],
    refTable: target.name, refColumns: [target.primaryKey[0] ?? target.columns[0]!.name], onDelete: 'RESTRICT', onUpdate: 'RESTRICT',
  };
}

// ---------------------------------------------------------------- seed rows
export function totalRows(schema: SchemaModel): number {
  return schema.tables.reduce((n, t) => n + t.seedRows, 0);
}

/** Row counts scaled by `factor` (rounded, at least 1 when the table had rows, capped at the model maximum). */
export function scaledRows(rows: number, factor: number): number {
  if (rows <= 0) return 0;
  return Math.min(2_000_000, Math.max(1, Math.round(rows * factor)));
}

// ---------------------------------------------------------------- problems
/** Codes produced by validateDesign that belong to the schema (the Schema Designer shows only these). */
export const SCHEMA_CODES = new Set([
  'DUP_TABLE', 'DUP_COLUMN', 'UNKNOWN_COLUMN', 'FK_UNKNOWN_TABLE', 'FK_ARITY', 'FK_UNKNOWN_COLUMN', 'FK_TARGET_NOT_UNIQUE', 'AI_NOT_KEY', 'BAD_IDENT', 'SEED_FKREF',
]);

export const isSchemaProblem = (p: Problem) => SCHEMA_CODES.has(p.code) || (!!p.path.table && !p.path.txn);

export function mergeProblems(...lists: Problem[][]): Problem[] {
  const seen = new Set<string>();
  const out: Problem[] = [];
  for (const p of lists.flat()) {
    const k = `${p.severity}|${p.code}|${p.message}|${p.path.table ?? ''}|${p.path.column ?? ''}`;
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out;
}

/** Table named in a MySQL error text (`Table 'dsim_x.enrollment'`, backticks, bare words). Longest name wins. */
export function findTableInMessage(message: string, tables: string[]): string | null {
  const hits = [...tables].sort((a, b) => b.length - a.length).filter((t) => new RegExp(`(^|[^a-z0-9_])${t}($|[^a-z0-9_])`).test(message));
  return hits[0] ?? null;
}
