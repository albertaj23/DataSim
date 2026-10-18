import { describe, expect, it } from 'vitest';
import { emptyDesign, type DesignDoc, type Transaction, type ValueGenerator } from '@datasim/shared';
import { dbFit, fitMetrics } from './dbFit';

const txn = (name: string, weight: number, readOnly: boolean, sqls: string[], extra: Partial<Transaction> = {}): Transaction => ({
  name, weight, readOnly, cacheable: false, description: '', params: {}, variants: { default: sqls.map((sql) => ({ sql })) }, ...extra,
});
const zipf: ValueGenerator = { kind: 'zipf', n: 1000, s: 1.1, min: 1 };
function design(txns: Transaction[], opts: { redis?: boolean; vus?: number; invariants?: number; rows?: number; fk?: boolean } = {}): DesignDoc {
  const d = emptyDesign();
  d.nodes.push({ id: 'u', name: 'Users', type: 'users', position: { x: 0, y: 0 }, config: { vus: opts.vus ?? 200, thinkMinMs: 1, thinkMaxMs: 2, thinkDist: 'uniform', pattern: 'constant', durationS: 10, warmupS: 1 } });
  if (opts.redis) d.nodes.push({ id: 'r', name: 'Cache', type: 'redis', position: { x: 0, y: 0 }, config: { ttlS: 30 } });
  d.workload.transactions = txns;
  d.workload.invariants = Array.from({ length: opts.invariants ?? 0 }, (_, i) => ({ name: `inv_${i}`, description: '', sql: 'SELECT 0' }));
  d.schema.tables = [{
    name: 'section', columns: [{ name: 'section_id', type: { kind: 'INT', unsigned: false }, nullable: false, autoIncrement: true }], primaryKey: ['section_id'],
    uniques: [], indexes: [], checks: [], seedRows: opts.rows ?? 1200,
    foreignKeys: opts.fk ? [{ columns: ['section_id'], refTable: 'section', refColumns: ['section_id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }] : [],
  }];
  return d;
}
const ids = (d: DesignDoc) => dbFit(d).recommendations.map((r) => r.id);

describe('fitMetrics', () => {
  it('computes mix shares from weights', () => {
    const m = fitMetrics(design([
      txn('reg', 55, false, ['SELECT 1', 'INSERT INTO e VALUES (1)', 'UPDATE s SET n = n + 1'], { params: { sid: zipf } }),
      txn('search', 35, true, ['SELECT * FROM s WHERE a = 1'], { cacheable: true }),
      txn('mine', 10, true, ['SELECT * FROM e']),
    ]));
    expect(m.readShare).toBeCloseTo(0.45);
    expect(m.writeShare).toBeCloseTo(0.55);
    expect(m.cacheableShare).toBeCloseTo(0.35);
    expect(m.hotWriteShare).toBeCloseTo(0.55);
    expect(m.multiStatementWrites).toEqual(['reg']);
    expect(m.vus).toBe(200);
  });
});

describe('dbFit rules', () => {
  const registration = design([
    txn('register', 55, false, ['SELECT enrolled FROM section WHERE id = :sid', 'INSERT INTO enrollment VALUES (1)', 'UPDATE section SET enrolled = enrolled + 1'], { params: { sid: zipf } }),
    txn('search', 35, true, ['SELECT * FROM section s JOIN course c ON 1=1 LIMIT 20'], { cacheable: true }),
    txn('timetable', 10, true, ['SELECT * FROM enrollment']),
  ], { invariants: 2, fk: true });

  it('course-registration style: stay relational, add a cache, warn about the hot row', () => {
    const r = ids(registration);
    expect(r).toContain('relational-oltp');
    expect(r).toContain('cache');
    expect(r).toContain('hot-row');
    const rel = dbFit(registration).recommendations.find((x) => x.id === 'relational-oltp')!;
    expect(rel.level).toBe('strong');
    expect(rel.evidence.join(' ')).toMatch(/invariant/);
    expect(dbFit(registration).recommendations.find((x) => x.id === 'cache')!.title).toMatch(/Add a Redis cache/);
  });

  it('with a cache node present it says keep, not add', () => {
    const d = design(registration.workload.transactions, { redis: true, invariants: 2, fk: true });
    expect(dbFit(d).recommendations.find((x) => x.id === 'cache')!.title).toMatch(/Keep/);
  });

  it('read-heavy at high concurrency suggests a read replica', () => {
    const d = design([txn('q', 90, true, ['SELECT * FROM a WHERE id = 1'], { cacheable: true }), txn('w', 10, false, ['UPDATE a SET x = 1'])], { vus: 300 });
    expect(ids(d)).toContain('read-replica');
  });

  it('aggregating scans point at a columnar store', () => {
    const d = design([txn('report', 20, true, ['SELECT dept, COUNT(*) FROM student GROUP BY dept']), txn('w', 80, false, ['INSERT INTO a VALUES (1)'])], { rows: 500_000 });
    const c = dbFit(d).recommendations.find((x) => x.id === 'columnar')!;
    expect(c).toBeTruthy();
    expect(c.level).toBe('consider');
  });

  it('write-heavy at scale warns about the single-primary ceiling', () => {
    const d = design([txn('w', 80, false, ['INSERT INTO a VALUES (1)']), txn('r', 20, true, ['SELECT 1'])], { vus: 200 });
    expect(ids(d)).toContain('write-ceiling');
  });

  it('simple key access with no constraints also fits a key-value store', () => {
    const d = design([txn('get', 80, true, ['SELECT v FROM kv WHERE k = :k']), txn('put', 20, false, ['UPDATE kv SET v = :v WHERE k = :k'])]);
    expect(ids(d)).toContain('key-value');
    expect(ids(registration)).not.toContain('key-value');
  });

  it('an empty workload asks for a workload instead of guessing', () => {
    expect(ids(design([]))).toEqual(['no-workload']);
  });
});
