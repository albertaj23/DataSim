// Turns a normalization result (a list of relation fragments) into tables of the design schema.
// Pure: mutates the SchemaModel it is given (call it inside `useDesignStore.update`, or on a clone to preview).
import type { Column, ColumnType, DesignDoc, Fragment, SchemaModel, Table } from '@datasim/shared';
import { IDENT_RE } from '@datasim/shared';
import { layoutTables, TABLE_W } from '../schema/layout';
import { uniqueName } from '../schema/logic';

export interface ApplyOptions {
  /** Existing table whose columns supply types; null for a free-standing universal relation. */
  sourceTable: string | null;
  fragments: Fragment[];
  /** Remove the source table and put the decomposed tables in its place (default true when a source exists). */
  replaceSource?: boolean;
  /** Seed rows for fragments when there is no source table. */
  defaultRows?: number;
}

export interface PlannedTable { name: string; attributes: string[]; primaryKey: string[]; foreignKeys: Array<{ columns: string[]; refTable: string; refColumns: string[] }>; role: 'child' | 'parent' | 'standalone' }
export interface ApplyResult {
  created: string[];
  /** Name of the removed source table, if any. */
  removed: string | null;
  warnings: string[];
  tables: PlannedTable[];
}

/** "StudentID" -> "student_id", "Course Name" -> "course_name"; always a valid identifier. */
export function toIdent(attr: string): string {
  let s = attr.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) s = 'col';
  if (!/^[a-z]/.test(s)) s = `c_${s}`;
  return s.slice(0, 64);
}

/** Column type guess for an attribute that has no source column. */
export function guessType(attr: string): ColumnType {
  const n = toIdent(attr);
  if (/(^|_)(id|no|num|number|count|qty|quantity|year|age|code_no)$/.test(n) || /^(id|no)$/.test(n)) return { kind: 'INT', unsigned: false };
  if (/(price|amount|cgpa|gpa|balance|salary|fee|cost|total)/.test(n)) return { kind: 'DECIMAL', precision: 10, scale: 2 };
  if (/(^|_)(date|dob)$/.test(n)) return { kind: 'DATE' };
  return { kind: 'VARCHAR', length: 80 };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const within = (a: string[], b: string[]) => a.every((x) => b.includes(x));

/** True when every source-column identifier mentioned in `expr` is in `allowed` (so a check/generated expression still makes sense). */
function refsWithin(expr: string, sourceCols: string[], allowed: Set<string>): boolean {
  const words = expr.replace(/'(?:[^'\\]|\\.|'')*'/g, ' ').match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  return words.every((w) => !sourceCols.includes(w.toLowerCase()) || allowed.has(w.toLowerCase()));
}

function fragmentBaseName(keyCols: string[]): string {
  if (keyCols.length === 1) {
    const k = keyCols[0]!;
    const m = k.match(/^(.+?)_?id$/);
    const base = m ? m[1]! : k;
    return base.length <= 2 ? `r_${base}` : base;
  }
  return keyCols.map((k) => k.match(/^(.+?)_?id$/)?.[1] ?? k).join('_').slice(0, 56);
}

/** Everything that would be created, computed on a copy: use it for the preview, then call `applyDecomposition` for real. */
export function previewDecomposition(schema: SchemaModel, opts: ApplyOptions): ApplyResult {
  return applyDecomposition(structuredClone(schema), opts);
}

export function applyDecomposition(schema: SchemaModel, opts: ApplyOptions): ApplyResult {
  const src = opts.sourceTable ? schema.tables.find((t) => t.name === opts.sourceTable) ?? null : null;
  if (opts.sourceTable && !src) throw new Error(`Table ${opts.sourceTable} no longer exists`);
  if (opts.fragments.length === 0) throw new Error('Nothing to apply: the decomposition has no relations');
  const replace = !!src && opts.replaceSource !== false;
  const warnings: string[] = [];

  // attribute -> column identifier (a source table's columns are already valid identifiers)
  const colOf = new Map<string, string>();
  const used = new Set<string>();
  const allAttrs = [...new Set(opts.fragments.flatMap((f) => f.attributes))];
  for (const a of allAttrs) {
    let c = src?.columns.some((x) => x.name === a) ? a : toIdent(a);
    for (let i = 2; used.has(c); i++) c = `${toIdent(a)}_${i}`.slice(0, 64);
    used.add(c); colOf.set(a, c);
  }
  const cols = (attrs: string[]) => attrs.map((a) => colOf.get(a)!);
  const srcCols = src ? src.columns.map((c) => c.name) : [];

  // The fragment that keeps the source table's identity: it contains the whole source primary key.
  const mainIdx = src ? opts.fragments.reduce((best, f, i) => {
    if (!within(src.primaryKey, cols(f.attributes))) return best;
    return best < 0 || f.attributes.length > opts.fragments[best]!.attributes.length ? i : best;
  }, -1) : -1;

  const taken = new Set(schema.tables.filter((t) => !(replace && t.name === src!.name)).map((t) => t.name));
  const names: string[] = [];
  opts.fragments.forEach((f, i) => {
    const keyCols = cols(f.keys[0] ?? f.attributes);
    const base = IDENT_RE.test(fragmentBaseName(keyCols)) ? fragmentBaseName(keyCols) : 'relation';
    // A taken name gets a descriptive suffix first (student -> student_info), then a counter.
    const name = i === mainIdx && replace ? src!.name : taken.has(base) ? uniqueName(`${base}_info`, taken) : base;
    taken.add(name); names.push(name);
  });

  // Foreign keys between fragments: A references B when a key of B lies inside A and is not one of A's own keys.
  const fkOf: Array<Array<{ columns: string[]; refIdx: number; refColumns: string[] }>> = opts.fragments.map(() => []);
  const referenced = new Set<number>();
  opts.fragments.forEach((a, i) => {
    opts.fragments.forEach((b, j) => {
      if (i === j) return;
      const key = b.keys.find((k) => within(k, a.attributes));
      if (!key || a.keys.some((k) => sameSet(k, key))) return;
      if (fkOf[j]!.some((x) => x.refIdx === i)) return; // never create a two-way cycle
      fkOf[i]!.push({ columns: cols(key), refIdx: j, refColumns: cols(key) });
      referenced.add(j);
    });
  });

  const base = src?.seedRows ?? opts.defaultRows ?? 200;
  const tables: Table[] = opts.fragments.map((f, i) => {
    const attrCols = cols(f.attributes);
    const isMain = i === mainIdx;
    const key = (isMain && src && f.keys.find((k) => sameSet(cols(k), src.primaryKey))) || f.keys[0] || f.attributes;
    const pk = cols(key);
    const fkCols = new Set(fkOf[i]!.flatMap((x) => x.columns));
    const allowed = new Set(attrCols);
    const columns: Column[] = f.attributes.map((a) => {
      const name = colOf.get(a)!;
      const sc = src?.columns.find((c) => c.name === name);
      const inKey = pk.includes(name);
      const c: Column = {
        name,
        type: sc ? structuredClone(sc.type) : guessType(a),
        nullable: inKey ? false : sc ? sc.nullable : false,
        autoIncrement: !!sc?.autoIncrement && isMain && pk.length === 1 && inKey,
      };
      if (sc?.default !== undefined) c.default = sc.default;
      if (sc?.generated && refsWithin(sc.generated.expr, srcCols, allowed)) c.generated = structuredClone(sc.generated);
      // Seeds: keep the source's for the main table; parents get unique inferred keys. Columns under a new FK are filled from the parent by the seeder.
      const sd = sc?.seed;
      const seedOk = sd && (isMain || !inKey) && !fkCols.has(name) && sd.kind !== 'expression'
        && !(sd.kind === 'fkRef' && src && sd.table === src.name)
        && !(sd.kind === 'email' && sd.from && !allowed.has(sd.from));
      if (seedOk) c.seed = structuredClone(sd);
      return c;
    });
    const otherKeys = f.keys.filter((k) => !sameSet(cols(k), pk));
    const t: Table = {
      name: names[i]!,
      columns,
      primaryKey: pk,
      uniques: otherKeys.map((k) => ({ columns: cols(k) })),
      indexes: [], foreignKeys: [], checks: [],
      seedRows: referenced.has(i) ? Math.max(5, Math.min(base, Math.ceil(base / 10))) : base,
    };
    if (src) {
      for (const u of src.uniques) if (within(u.columns, attrCols) && !sameSet(u.columns, pk) && !t.uniques.some((x) => sameSet(x.columns, u.columns))) t.uniques.push(structuredClone(u));
      for (const ix of src.indexes) if (within(ix.columns, attrCols)) t.indexes.push(structuredClone(ix));
      for (const ck of src.checks) if (refsWithin(ck.expr, srcCols, allowed) && srcCols.some((c) => new RegExp(`\\b${c}\\b`, 'i').test(ck.expr) && allowed.has(c))) t.checks.push(structuredClone(ck));
      for (const fk of src.foreignKeys) {
        if (within(fk.columns, attrCols)) t.foreignKeys.push(structuredClone(fk));
        else if (isMain) warnings.push(`Foreign key (${fk.columns.join(', ')}) to ${fk.refTable} was dropped: its columns are split across tables`);
      }
    }
    for (const x of fkOf[i]!) {
      t.foreignKeys.push({ columns: x.columns, refTable: names[x.refIdx]!, refColumns: x.refColumns, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
    }
    return t;
  });

  // Foreign keys from other tables that pointed at the source must follow the columns they reference.
  if (src && replace) {
    for (const other of schema.tables) {
      if (other === src) continue;
      other.foreignKeys = other.foreignKeys.flatMap((fk) => {
        if (fk.refTable !== src.name) return [fk];
        const target = tables.find((t) => within(fk.refColumns, t.columns.map((c) => c.name)) && (sameSet(t.primaryKey, fk.refColumns) || t.uniques.some((u) => sameSet(u.columns, fk.refColumns))))
          ?? tables.find((t) => within(fk.refColumns, t.columns.map((c) => c.name)));
        if (!target) { warnings.push(`Foreign key ${other.name}(${fk.columns.join(', ')}) was dropped: ${src.name}(${fk.refColumns.join(', ')}) is split across tables`); return []; }
        if (!sameSet(target.primaryKey, fk.refColumns) && !target.uniques.some((u) => sameSet(u.columns, fk.refColumns))) {
          warnings.push(`Foreign key ${other.name}(${fk.columns.join(', ')}) was dropped: ${target.name}(${fk.refColumns.join(', ')}) is not a key there`);
          return [];
        }
        return [{ ...fk, refTable: target.name }];
      });
    }
  }

  // Place the new tables: where the source was, else to the right of everything.
  const others = schema.tables.filter((t) => !(replace && t === src));
  const lay = layoutTables({ tables });
  const placed = others.filter((t) => t.position);
  const origin = src?.position && replace
    ? src.position
    : { x: placed.length ? Math.max(...placed.map((t) => t.position!.x)) + TABLE_W + 80 : 0, y: placed.length ? Math.min(...placed.map((t) => t.position!.y)) : 0 };
  const minX = Math.min(...Object.values(lay).map((p) => p.x));
  const minY = Math.min(...Object.values(lay).map((p) => p.y));
  for (const t of tables) t.position = { x: Math.round(origin.x + lay[t.name]!.x - minX), y: Math.round(origin.y + lay[t.name]!.y - minY) };

  const at = src ? schema.tables.indexOf(src) : schema.tables.length;
  schema.tables.splice(at, replace ? 1 : 0, ...tables);
  return {
    created: tables.map((t) => t.name),
    removed: replace ? src!.name : null,
    warnings,
    tables: tables.map((t, i) => ({
      name: t.name,
      attributes: opts.fragments[i]!.attributes,
      primaryKey: t.primaryKey,
      foreignKeys: t.foreignKeys.filter((fk) => names.includes(fk.refTable) && fk.refTable !== src?.name).map((fk) => ({ columns: fk.columns, refTable: fk.refTable, refColumns: fk.refColumns })),
      role: referenced.has(i) ? 'parent' : fkOf[i]!.length ? 'child' : 'standalone',
    })),
  };
}

/** Transactions and invariants whose SQL mentions `table` (they break when the table is replaced). */
export function workloadMentions(design: Pick<DesignDoc, 'workload'>, table: string): string[] {
  const re = new RegExp(`(^|[^A-Za-z0-9_])\`?${table}\`?($|[^A-Za-z0-9_])`, 'i');
  const hits: string[] = [];
  for (const t of design.workload.transactions) {
    if (Object.values(t.variants).some((steps) => steps.some((s) => re.test(s.sql)))) hits.push(t.name);
  }
  for (const inv of design.workload.invariants) if (re.test(inv.sql)) hits.push(`invariant ${inv.name}`);
  return hits;
}
