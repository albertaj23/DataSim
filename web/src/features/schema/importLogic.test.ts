import { describe, expect, it } from 'vitest';
import { SchemaModel } from '@datasim/shared';
import { mergeImported } from './importLogic';

const t = (name: string, fkTo?: string) => ({
  name, primaryKey: ['id'],
  columns: [{ name: 'id', type: { kind: 'INT' } }, ...(fkTo ? [{ name: 'p_id', type: { kind: 'INT' } }] : [])],
  foreignKeys: fkTo ? [{ columns: ['p_id'], refTable: fkTo, refColumns: ['id'] }] : [],
  position: { x: 0, y: 0 },
});
const model = (...tables: ReturnType<typeof t>[]) => SchemaModel.parse({ tables });

describe('mergeImported', () => {
  it('replaces the schema and lays tables out left to right (parent before child)', () => {
    const target = model(t('old'));
    const r = mergeImported(target, model(t('child', 'parent'), t('parent')), 'replace');
    expect(r.added.sort()).toEqual(['child', 'parent']);
    expect(target.tables.map((x) => x.name).sort()).toEqual(['child', 'parent']);
    const x = (n: string) => target.tables.find((y) => y.name === n)!.position!.x;
    expect(x('parent')).toBeLessThan(x('child'));
  });
  it('adds only new table names, to the right of existing tables', () => {
    const target = model(t('a'), { ...t('b'), position: { x: 500, y: 40 } });
    const r = mergeImported(target, model(t('a'), t('c')), 'add');
    expect(r.skipped).toEqual(['a']);
    expect(r.added).toEqual(['c']);
    expect(target.tables.map((x) => x.name)).toEqual(['a', 'b', 'c']);
    expect(target.tables[2]!.position!.x).toBeGreaterThan(500 + 248);
    expect(SchemaModel.safeParse(target).success).toBe(true);
  });
});
