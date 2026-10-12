import { z } from 'zod';

/** Identifiers are always backtick-quoted in generated SQL. */
export const IDENT_RE = /^[a-z][a-z0-9_]{0,63}$/;
export const Ident = z.string().regex(IDENT_RE, 'lowercase letters, digits and _ ; must start with a letter; max 64');

// ---------------------------------------------------------------- value generators (seed + workload params)
const Num = z.number().finite();
export const ValueGenerator = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sequence'), start: Num.default(1), step: Num.default(1) }),
  z.object({ kind: z.literal('uniformInt'), min: Num, max: Num }),
  z.object({ kind: z.literal('normalInt'), mean: Num, stddev: Num.positive(), min: Num.optional(), max: Num.optional() }),
  /** Rank 1..n with P(k) proportional to 1/k^s, shifted by `min` (so min=1 gives ranks 1..n). */
  z.object({ kind: z.literal('zipf'), n: z.number().int().positive(), s: Num.positive().default(1.1), min: Num.default(1) }),
  z.object({ kind: z.literal('decimalRange'), min: Num, max: Num, scale: z.number().int().min(0).max(6).default(2) }),
  z.object({ kind: z.literal('pickList'), values: z.array(z.union([z.string(), z.number()])).min(1), weights: z.array(Num.positive()).optional() }),
  z.object({ kind: z.literal('personName') }),
  /** Derived from another column of the same row (usually a name column), else from the row index. */
  z.object({ kind: z.literal('email'), from: Ident.optional(), domain: z.string().default('example.edu') }),
  /** `#` = digit, `@` = uppercase letter. Sequential fills the placeholders from the row index (unique); random is random. */
  z.object({ kind: z.literal('pattern'), pattern: z.string().min(1), mode: z.enum(['sequential', 'random']).default('sequential') }),
  z.object({ kind: z.literal('dateRange'), from: z.string(), to: z.string() }),
  z.object({ kind: z.literal('constant'), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
  /** Draw an existing parent key (loaded before this table is seeded). */
  z.object({ kind: z.literal('fkRef'), table: Ident, column: Ident, dist: z.enum(['uniform', 'zipf']).default('uniform'), s: Num.positive().default(1.1) }),
  /** Limited arithmetic/string expression over other columns of the row: + - * / ( ), numbers, 'strings', column names, fns upper lower concat round floor abs. */
  z.object({ kind: z.literal('expression'), expr: z.string().min(1) }),
  /** Workload params only: sample keys of an existing table (loaded once at run start). */
  z.object({ kind: z.literal('fromTable'), table: Ident, column: Ident, dist: z.enum(['uniform', 'zipf']).default('uniform'), s: Num.positive().default(1.1) }),
]);
export type ValueGenerator = z.infer<typeof ValueGenerator>;

// ---------------------------------------------------------------- column types
export const ColumnType = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['TINYINT', 'SMALLINT', 'INT', 'BIGINT']), unsigned: z.boolean().default(false) }),
  z.object({ kind: z.literal('DECIMAL'), precision: z.number().int().min(1).max(38), scale: z.number().int().min(0).max(30) }),
  z.object({ kind: z.enum(['FLOAT', 'DOUBLE', 'BOOLEAN', 'TEXT', 'DATE', 'JSON', 'DATETIME', 'TIMESTAMP']) }),
  z.object({ kind: z.enum(['CHAR', 'VARCHAR']), length: z.number().int().min(1).max(4000) }),
  z.object({ kind: z.literal('ENUM'), values: z.array(z.string().min(1)).min(1) }),
]);
export type ColumnType = z.infer<typeof ColumnType>;
export const COLUMN_KINDS = ['TINYINT', 'SMALLINT', 'INT', 'BIGINT', 'DECIMAL', 'FLOAT', 'DOUBLE', 'BOOLEAN', 'CHAR', 'VARCHAR', 'TEXT', 'DATE', 'DATETIME', 'TIMESTAMP', 'ENUM', 'JSON'] as const;

/** DEFAULT: literal, or {expr} for SQL expressions such as CURRENT_TIMESTAMP(3). */
export const ColumnDefault = z.union([z.string(), z.number(), z.boolean(), z.null(), z.object({ expr: z.string().min(1) })]);

export const Column = z.object({
  name: Ident,
  type: ColumnType,
  nullable: z.boolean().default(false),
  default: ColumnDefault.optional(),
  autoIncrement: z.boolean().default(false),
  /** STORED generated column expression (SQL). */
  generated: z.object({ expr: z.string().min(1) }).optional(),
  /** Per-column seed generator; defaults are inferred when omitted (autoIncrement/generated columns are skipped). */
  seed: ValueGenerator.optional(),
});
export type Column = z.infer<typeof Column>;

export const ReferentialAction = z.enum(['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION']);
export const Table = z.object({
  name: Ident,
  columns: z.array(Column).min(1),
  primaryKey: z.array(Ident).min(1),
  uniques: z.array(z.object({ name: Ident.optional(), columns: z.array(Ident).min(1) })).default([]),
  indexes: z.array(z.object({ name: Ident, columns: z.array(Ident).min(1), unique: z.boolean().default(false) })).default([]),
  foreignKeys: z.array(z.object({
    name: Ident.optional(), columns: z.array(Ident).min(1), refTable: Ident, refColumns: z.array(Ident).min(1),
    onDelete: ReferentialAction.default('RESTRICT'), onUpdate: ReferentialAction.default('RESTRICT'),
  })).default([]),
  checks: z.array(z.object({ name: Ident.optional(), expr: z.string().min(1) })).default([]),
  seedRows: z.number().int().min(0).max(2_000_000).default(0),
  /** ER-canvas position (UI only). */
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type Table = z.infer<typeof Table>;

export const SchemaModel = z.object({ tables: z.array(Table).default([]) });
export type SchemaModel = z.infer<typeof SchemaModel>;
