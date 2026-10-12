// Tiny helpers so the template files read like schemas, not like zod input objects.
import type { ColumnType, ValueGenerator } from '@datasim/shared';

export const INT: ColumnType = { kind: 'INT', unsigned: false };
export const BIGINT: ColumnType = { kind: 'BIGINT', unsigned: false };
export const SMALLINT: ColumnType = { kind: 'SMALLINT', unsigned: false };
export const TINYINT: ColumnType = { kind: 'TINYINT', unsigned: false };
export const BOOL: ColumnType = { kind: 'BOOLEAN' };
export const DT3: ColumnType = { kind: 'DATETIME' };
export const varchar = (length: number): ColumnType => ({ kind: 'VARCHAR', length });
export const char = (length: number): ColumnType => ({ kind: 'CHAR', length });
export const decimal = (precision: number, scale: number): ColumnType => ({ kind: 'DECIMAL', precision, scale });
export const enumOf = (...values: string[]): ColumnType => ({ kind: 'ENUM', values });

type ColOpts = { null?: boolean; ai?: boolean; def?: string | number | boolean | null | { expr: string }; seed?: ValueGenerator; generated?: string };
export const col = (name: string, type: ColumnType, o: ColOpts = {}) => ({
  name, type, nullable: !!o.null, autoIncrement: !!o.ai,
  ...(o.def !== undefined ? { default: o.def } : {}),
  ...(o.seed ? { seed: o.seed } : {}),
  ...(o.generated ? { generated: { expr: o.generated } } : {}),
});

export const uniformInt = (min: number, max: number): ValueGenerator => ({ kind: 'uniformInt', min, max });
export const pick = (values: Array<string | number>, weights?: number[]): ValueGenerator => ({ kind: 'pickList', values, ...(weights ? { weights } : {}) });
export const pattern = (p: string): ValueGenerator => ({ kind: 'pattern', pattern: p, mode: 'sequential' });
export const fkRef = (table: string, column: string, dist: 'uniform' | 'zipf' = 'uniform', s = 1.1): ValueGenerator => ({ kind: 'fkRef', table, column, dist, s });
export const fromTable = (table: string, column: string, dist: 'uniform' | 'zipf' = 'uniform', s = 1.1): ValueGenerator => ({ kind: 'fromTable', table, column, dist, s });

/** Left-to-right canvas layout used by every template. */
export const POS = { users: { x: 0, y: 140 }, lb: { x: 320, y: 140 }, app: { x: 640, y: 140 }, cache: { x: 960, y: 20 }, db: { x: 960, y: 260 } };
export const edge = (source: string, target: string, latencyMs = 1, jitterMs = 0) => ({ id: `e_${source}_${target}`, source, target, latencyMs, jitterMs });
