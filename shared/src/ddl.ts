import type { Column, ColumnType, SchemaModel, Table } from './schema';

export const q = (ident: string) => `\`${ident.replace(/`/g, '``')}\``;
const lit = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
const short = (s: string) => (s.length <= 64 ? s : s.slice(0, 64));

export function columnTypeSql(t: ColumnType): string {
  switch (t.kind) {
    case 'TINYINT': case 'SMALLINT': case 'INT': case 'BIGINT': return t.unsigned ? `${t.kind} UNSIGNED` : t.kind;
    case 'DECIMAL': return `DECIMAL(${t.precision},${t.scale})`;
    case 'CHAR': case 'VARCHAR': return `${t.kind}(${t.length})`;
    case 'DATETIME': case 'TIMESTAMP': return `${t.kind}(3)`;
    case 'ENUM': return `ENUM(${t.values.map(lit).join(',')})`;
    default: return t.kind;
  }
}

function defaultSql(c: Column): string {
  const d = c.default;
  if (d === undefined) return '';
  if (d === null) return ' DEFAULT NULL';
  if (typeof d === 'boolean') return ` DEFAULT ${d ? 1 : 0}`;
  if (typeof d === 'number') return ` DEFAULT ${d}`;
  if (typeof d === 'string') return ` DEFAULT ${lit(d)}`;
  return /^CURRENT_TIMESTAMP(\(\d*\))?$/i.test(d.expr.trim()) ? ` DEFAULT ${d.expr.trim()}` : ` DEFAULT (${d.expr})`;
}

function columnSql(c: Column): string {
  const base = `${q(c.name)} ${columnTypeSql(c.type)}`;
  if (c.generated) return `${base} GENERATED ALWAYS AS (${c.generated.expr}) STORED${c.nullable ? '' : ' NOT NULL'}`;
  return `${base}${c.nullable ? ' NULL' : ' NOT NULL'}${defaultSql(c)}${c.autoIncrement ? ' AUTO_INCREMENT' : ''}`;
}

const cols = (list: string[]) => list.map(q).join(', ');

/** Orders tables so parents precede children. Tables in FK cycles are returned in `cyclic` (their cross FKs go to ALTERs). */
export function orderTables(schema: SchemaModel): { ordered: Table[]; deferred: Set<string> } {
  const byName = new Map(schema.tables.map((t) => [t.name, t]));
  const indeg = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const t of schema.tables) indeg.set(t.name, 0);
  for (const t of schema.tables) {
    for (const fk of t.foreignKeys) {
      if (fk.refTable === t.name || !byName.has(fk.refTable)) continue;
      indeg.set(t.name, (indeg.get(t.name) ?? 0) + 1);
      children.set(fk.refTable, [...(children.get(fk.refTable) ?? []), t.name]);
    }
  }
  const ready = schema.tables.filter((t) => indeg.get(t.name) === 0).map((t) => t.name).sort();
  const ordered: Table[] = [];
  while (ready.length) {
    const n = ready.shift()!;
    ordered.push(byName.get(n)!);
    for (const c of children.get(n) ?? []) {
      indeg.set(c, indeg.get(c)! - 1);
      if (indeg.get(c) === 0) { ready.push(c); ready.sort(); }
    }
  }
  const deferred = new Set<string>();
  for (const t of [...schema.tables].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ordered.includes(t)) { ordered.push(t); deferred.add(t.name); }
  }
  return { ordered, deferred };
}

const fkName = (t: Table, i: number) => short(t.foreignKeys[i]!.name ?? `fk_${t.name}_${t.foreignKeys[i]!.columns.join('_')}`);
const fkSql = (t: Table, i: number) => {
  const fk = t.foreignKeys[i]!;
  return `CONSTRAINT ${q(fkName(t, i))} FOREIGN KEY (${cols(fk.columns)}) REFERENCES ${q(fk.refTable)} (${cols(fk.refColumns)}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`;
};

export function createTableSql(t: Table, includeFks = true): string {
  const lines: string[] = t.columns.map(columnSql);
  lines.push(`PRIMARY KEY (${cols(t.primaryKey)})`);
  t.uniques.forEach((u) => lines.push(`CONSTRAINT ${q(short(u.name ?? `uq_${t.name}_${u.columns.join('_')}`))} UNIQUE (${cols(u.columns)})`));
  t.indexes.forEach((ix) => lines.push(`${ix.unique ? 'UNIQUE ' : ''}INDEX ${q(ix.name)} (${cols(ix.columns)})`));
  if (includeFks) t.foreignKeys.forEach((_, i) => lines.push(fkSql(t, i)));
  t.checks.forEach((c, i) => lines.push(`CONSTRAINT ${q(short(c.name ?? `ck_${t.name}_${i + 1}`))} CHECK (${c.expr})`));
  return `CREATE TABLE ${q(t.name)} (\n  ${lines.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
}

/** Deterministic DDL: tables ordered by FK dependency; cyclic FKs become trailing ALTER TABLE statements. */
export function generateDdl(schema: SchemaModel): { statements: string[]; sql: string } {
  const { ordered, deferred } = orderTables(schema);
  const statements: string[] = [];
  const alters: string[] = [];
  for (const t of ordered) {
    const isDeferred = deferred.has(t.name);
    statements.push(createTableSql(t, !isDeferred));
    if (isDeferred) t.foreignKeys.forEach((_, i) => alters.push(`ALTER TABLE ${q(t.name)} ADD ${fkSql(t, i)}`));
  }
  statements.push(...alters);
  return { statements, sql: statements.map((s) => `${s};`).join('\n\n') + (statements.length ? '\n' : '') };
}
