import type { Connection, RowDataPacket } from 'mysql2/promise';
import { SchemaModel, IDENT_RE } from '@datasim/shared';
import type { Column, ColumnType, Table } from '@datasim/shared';
import { ServiceError } from '../services/liveStrategy.js';
import { withScratchSchema } from './scratch.js';

export interface ImportDdlResponse { schema: SchemaModel; warnings: string[] }

/** Splits on `;` outside quotes/backticks and drops `--`, `#` and block comments. */
export function splitStatements(ddl: string): string[] {
  const out: string[] = []; let cur = ''; let i = 0;
  while (i < ddl.length) {
    const c = ddl[i]!;
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < ddl.length && ddl[j] !== c) { if (ddl[j] === '\\' && c !== '`') j++; j++; }
      cur += ddl.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '-' && ddl[i + 1] === '-' || c === '#') { while (i < ddl.length && ddl[i] !== '\n') i++; continue; }
    if (c === '/' && ddl[i + 1] === '*') { const e = ddl.indexOf('*/', i + 2); i = e < 0 ? ddl.length : e + 2; cur += ' '; continue; }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const stripLiterals = (s: string) => s.replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"/g, "''");
const ALLOWED = /^(create\s+table|alter\s+table|create\s+(unique\s+)?index)\b/i;

/** The pasted text runs as admin, so only table-shaped DDL on unqualified names is accepted. */
export function checkStatements(stmts: string[]): string | null {
  for (const s of stmts) {
    if (!ALLOWED.test(s)) return `Only CREATE TABLE, ALTER TABLE and CREATE INDEX are accepted (found: ${s.slice(0, 40)}...)`;
    if (/[A-Za-z_`]\s*\.\s*[A-Za-z_`]/.test(stripLiterals(s))) return 'Qualified names (schema.table) are not accepted; use bare table names';
  }
  return null;
}

function colType(r: RowDataPacket, warnings: string[]): ColumnType {
  const ct = String(r.COLUMN_TYPE); const dt = String(r.DATA_TYPE).toLowerCase(); const unsigned = /unsigned/i.test(ct);
  if (dt === 'tinyint' && /^tinyint\(1\)/i.test(ct)) return { kind: 'BOOLEAN' };
  switch (dt) {
    case 'tinyint': return { kind: 'TINYINT', unsigned };
    case 'smallint': return { kind: 'SMALLINT', unsigned };
    case 'int': case 'mediumint': return { kind: 'INT', unsigned };
    case 'bigint': return { kind: 'BIGINT', unsigned };
    case 'decimal': return { kind: 'DECIMAL', precision: Number(r.NUMERIC_PRECISION), scale: Number(r.NUMERIC_SCALE) };
    case 'float': case 'double': case 'date': case 'json': case 'timestamp': return { kind: dt.toUpperCase() as 'FLOAT' };
    case 'datetime': return { kind: 'DATETIME' };
    case 'char': case 'varchar': return { kind: dt.toUpperCase() as 'CHAR', length: Math.min(4000, Number(r.CHARACTER_MAXIMUM_LENGTH)) };
    case 'tinytext': case 'text': case 'mediumtext': case 'longtext': return { kind: 'TEXT' };
    case 'enum': return { kind: 'ENUM', values: [...ct.slice(5, -1).matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!.replace(/''/g, "'")) };
    default: warnings.push(`Column ${r.TABLE_NAME}.${r.COLUMN_NAME}: type ${ct} is not supported by the designer; imported as VARCHAR(255)`); return { kind: 'VARCHAR', length: 255 };
  }
}

function colDefault(r: RowDataPacket, type: ColumnType): Column['default'] {
  const d = r.COLUMN_DEFAULT; const extra = String(r.EXTRA);
  if (d === null || d === undefined) return undefined;
  if (/DEFAULT_GENERATED/i.test(extra)) return { expr: String(d) };
  if (type.kind === 'BOOLEAN') return Number(d) !== 0;
  if (['TINYINT', 'SMALLINT', 'INT', 'BIGINT', 'DECIMAL', 'FLOAT', 'DOUBLE'].includes(type.kind)) return Number(d);
  return String(d);
}

async function introspect(conn: Connection, db: string, warnings: string[]): Promise<SchemaModel> {
  const rows = async (sql: string) => (await conn.query<RowDataPacket[]>(sql, [db]))[0];
  const tables = await rows('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = \'BASE TABLE\' ORDER BY TABLE_NAME');
  const cols = await rows('SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION');
  const stats = await rows('SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX');
  const fks = await rows(`SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE
    FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
    WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`);
  const checks = await rows(`SELECT t.TABLE_NAME, c.CONSTRAINT_NAME, c.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS c JOIN information_schema.TABLE_CONSTRAINTS t
    ON t.CONSTRAINT_SCHEMA = c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME = c.CONSTRAINT_NAME WHERE c.CONSTRAINT_SCHEMA = ? AND t.CONSTRAINT_TYPE = 'CHECK' ORDER BY t.TABLE_NAME, c.CONSTRAINT_NAME`);

  const low = (s: string) => { if (!IDENT_RE.test(s)) warnings.push(`Name "${s}" was changed to lowercase snake_case`); return s.toLowerCase(); };
  const grouped = <T extends RowDataPacket>(list: T[], key: (r: T) => string) => { const m = new Map<string, T[]>(); for (const r of list) m.set(key(r), [...(m.get(key(r)) ?? []), r]); return m; };

  const out: Table[] = tables.map((tr, ti) => {
    const tn = tr.TABLE_NAME as string;
    const tcols = cols.filter((c) => c.TABLE_NAME === tn);
    const columns: Column[] = tcols.map((r) => {
      const type = colType(r, warnings); const extra = String(r.EXTRA);
      const col: Column = { name: low(r.COLUMN_NAME), type, nullable: r.IS_NULLABLE === 'YES', autoIncrement: /auto_increment/i.test(extra) };
      if (/GENERATED/i.test(extra) && !/DEFAULT_GENERATED/i.test(extra) && r.GENERATION_EXPRESSION) {
        col.generated = { expr: String(r.GENERATION_EXPRESSION) };
        if (/VIRTUAL/i.test(extra)) warnings.push(`Generated column ${tn}.${r.COLUMN_NAME} is VIRTUAL; the designer creates STORED columns`);
      } else { const d = colDefault(r, type); if (d !== undefined) col.default = d; }
      return col;
    });
    const idx = grouped(stats.filter((s) => s.TABLE_NAME === tn), (s) => s.INDEX_NAME);
    const tfks = [...grouped(fks.filter((f) => f.TABLE_NAME === tn), (f) => f.CONSTRAINT_NAME)];
    const fkIndexNames = new Set(tfks.map(([n]) => n));
    const table: Table = {
      name: low(tn), columns, primaryKey: (idx.get('PRIMARY') ?? []).map((s) => low(s.COLUMN_NAME)),
      uniques: [], indexes: [], foreignKeys: [], checks: [], seedRows: 100,
      position: { x: (ti % 3) * 320, y: Math.floor(ti / 3) * 280 },
    };
    for (const [name, list] of idx) {
      if (name === 'PRIMARY') continue;
      const columnsOf = list.map((s) => low(s.COLUMN_NAME));
      if (Number(list[0]!.NON_UNIQUE) === 0) table.uniques.push({ name: low(name), columns: columnsOf });
      else if (!fkIndexNames.has(name)) table.indexes.push({ name: low(name), columns: columnsOf, unique: false });
    }
    for (const [name, list] of tfks) {
      table.foreignKeys.push({
        name: low(name), columns: list.map((f) => low(f.COLUMN_NAME)), refTable: low(list[0]!.REFERENCED_TABLE_NAME), refColumns: list.map((f) => low(f.REFERENCED_COLUMN_NAME)),
        onDelete: list[0]!.DELETE_RULE, onUpdate: list[0]!.UPDATE_RULE,
      });
    }
    for (const c of checks.filter((x) => x.TABLE_NAME === tn)) table.checks.push({ name: low(c.CONSTRAINT_NAME), expr: String(c.CHECK_CLAUSE) });
    return table;
  });
  return SchemaModel.parse({ tables: out });
}

/** Paste CREATE TABLE DDL -> apply in a scratch schema as admin -> introspect information_schema -> SchemaModel. MySQL does the parsing. */
export async function importDdl(ddl: string): Promise<ImportDdlResponse> {
  const stmts = splitStatements(ddl);
  if (stmts.length === 0) throw new ServiceError(400, 'DDL_EMPTY', 'No statements found');
  const rejected = checkStatements(stmts);
  if (rejected) throw new ServiceError(400, 'DDL_REJECTED', rejected);
  const warnings: string[] = [];
  const schema = await withScratchSchema('import', async (conn, db) => {
    for (let i = 0; i < stmts.length; i++) {
      try { await conn.query(stmts[i]!); } catch (e) {
        throw new ServiceError(400, 'DDL_REJECTED', `Statement ${i + 1}: ${(e as { sqlMessage?: string }).sqlMessage ?? (e as Error).message}`, { statement: i + 1 });
      }
    }
    return introspect(conn, db, warnings);
  });
  return { schema, warnings: [...new Set(warnings)] };
}
