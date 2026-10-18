import { describe, expect, it } from 'vitest';
import { DesignDoc, Rng, canConnect, evalExpression, generateDdl, previewGenerator, SchemaModel, validateDesign, zipfSampler, extractPlaceholders } from '../src/index';

const schema = SchemaModel.parse({ tables: [
  { name: 'child', columns: [{ name: 'id', type: { kind: 'INT' }, autoIncrement: true }, { name: 'pid', type: { kind: 'INT' } }, { name: 'at', type: { kind: 'DATETIME' }, default: { expr: 'CURRENT_TIMESTAMP(3)' } }],
    primaryKey: ['id'], foreignKeys: [{ columns: ['pid'], refTable: 'parent', refColumns: ['id'] }], checks: [{ expr: '`id` > 0' }] },
  { name: 'parent', columns: [{ name: 'id', type: { kind: 'INT' }, autoIncrement: true }, { name: 'v', type: { kind: 'DECIMAL', precision: 4, scale: 2 }, generated: { expr: 'id * 2' } }], primaryKey: ['id'] },
] });

describe('shared', () => {
  it('orders DDL by FK dependency and is deterministic', () => {
    const a = generateDdl(schema); const b = generateDdl(schema);
    expect(a.sql).toBe(b.sql);
    expect(a.sql.indexOf('CREATE TABLE `parent`')).toBeLessThan(a.sql.indexOf('CREATE TABLE `child`'));
    expect(a.sql).toContain('DEFAULT CURRENT_TIMESTAMP(3)');
    expect(a.sql).toContain('GENERATED ALWAYS AS (id * 2) STORED');
  });
  it('prng is deterministic and zipf is skewed', () => {
    const r1 = new Rng(7); const r2 = new Rng(7);
    expect([r1.int(0, 100), r1.int(0, 100)]).toEqual([r2.int(0, 100), r2.int(0, 100)]);
    const z = zipfSampler(100, 1.1); const r = new Rng(1); let ones = 0;
    for (let i = 0; i < 5000; i++) if (z(r) === 1) ones++;
    expect(ones).toBeGreaterThan(5000 / 100 * 5);
  });
  it('previews generators and unique sequential patterns', () => {
    const p = previewGenerator({ kind: 'pattern', pattern: '2#BCE####', mode: 'sequential' }, 3);
    expect(p).toEqual(['20BCE0000', '20BCE0001', '20BCE0002']);
    expect(evalExpression("concat(upper(a), '-', b + 1)", { a: 'x', b: 2 })).toBe('X-3');
  });
  it('enforces connection rules and placeholders', () => {
    expect(canConnect('users', 'mysql').ok).toBe(false);
    expect(canConnect('app', 'redis').ok).toBe(true);
    expect(extractPlaceholders("SELECT :a, :$s.col, ':no' FROM t WHERE x = :a")).toEqual({ params: ['a'], binds: [{ name: 's', col: 'col' }] });
  });
  it('validates an empty design', () => {
    const problems = validateDesign(DesignDoc.parse({}));
    expect(problems.map((p) => p.code)).toEqual(expect.arrayContaining(['NO_USERS', 'NO_APP', 'NO_DB', 'NO_TXN']));
  });
});
