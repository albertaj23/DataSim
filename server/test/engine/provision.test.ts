import { afterAll, describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { DesignDoc } from '@datasim/shared';
import type { ProvisionProgressEvent } from '@datasim/shared';
import { adminConnect, sandboxName } from '../../src/engine/admin.js';
import { provision } from '../../src/engine/provision.js';
import { appPool } from '../../src/db/pool.js';
import { ServiceError } from '../../src/services/liveStrategy.js';
import { randomUUID } from 'node:crypto';

const projects: string[] = [];
const newId = () => { const id = randomUUID(); projects.push(id); return id; };
afterAll(async () => {
  const c = await adminConnect();
  for (const id of projects) await c.query(`DROP DATABASE IF EXISTS \`${sandboxName(id)}\``);
  await c.end();
  await appPool.end().catch(() => undefined);
});

const int = { kind: 'INT' } as const;
const school = () => DesignDoc.parse({
  seed: 7,
  schema: {
    tables: [
      { name: 'dept', primaryKey: ['dept_id'], seedRows: 5, columns: [{ name: 'dept_id', type: int, autoIncrement: true }, { name: 'code', type: { kind: 'VARCHAR', length: 8 } }], uniques: [{ columns: ['code'] }] },
      {
        name: 'student', primaryKey: ['student_id'], seedRows: 2500,
        columns: [
          { name: 'student_id', type: int, autoIncrement: true },
          { name: 'reg_no', type: { kind: 'CHAR', length: 9 }, seed: { kind: 'pattern', pattern: '24BCE####', mode: 'sequential' } },
          { name: 'name', type: { kind: 'VARCHAR', length: 80 }, seed: { kind: 'personName' } },
          { name: 'mail', type: { kind: 'VARCHAR', length: 120 }, seed: { kind: 'email', from: 'name' } },
          { name: 'dept_id', type: int },
          { name: 'year', type: { kind: 'TINYINT' }, seed: { kind: 'uniformInt', min: 1, max: 4 } },
          { name: 'cgpa', type: { kind: 'DECIMAL', precision: 4, scale: 2 }, seed: { kind: 'decimalRange', min: 5, max: 10, scale: 2 } },
          { name: 'label', type: { kind: 'VARCHAR', length: 40 }, seed: { kind: 'expression', expr: "concat(upper('s'), year)" } },
          { name: 'twice', type: int, generated: { expr: 'year * 2' } },
          { name: 'joined', type: { kind: 'DATETIME' }, default: { expr: 'CURRENT_TIMESTAMP(3)' } },
        ],
        uniques: [{ columns: ['reg_no'] }],
        foreignKeys: [{ columns: ['dept_id'], refTable: 'dept', refColumns: ['dept_id'] }],
        checks: [{ expr: '`year` BETWEEN 1 AND 5' }, { expr: '`cgpa` BETWEEN 0 AND 10' }],
      },
    ],
  },
});

async function dump(db: string, sql: string): Promise<RowDataPacket[]> {
  const c = await adminConnect(db);
  try { const [rows] = await c.query<RowDataPacket[]>(sql); return rows; } finally { await c.end(); }
}

describe('provisioner', () => {
  it('applies DDL, seeds the requested row counts and reports progress', async () => {
    const id = newId();
    const events: ProvisionProgressEvent[] = [];
    const res = await provision(id, school(), { onProgress: (e) => events.push(e) });
    expect(res.database).toBe(sandboxName(id));
    expect(res.tables).toBe(2);
    expect(res.rows).toBe(2505);
    const counts = await dump(res.database, 'SELECT (SELECT COUNT(*) FROM dept) AS d, (SELECT COUNT(*) FROM student) AS s');
    expect(Number(counts[0]!.d)).toBe(5);
    expect(Number(counts[0]!.s)).toBe(2500);
    // 1,000-row batches: 1 for dept, 3 for student (1000 + 1000 + 500)
    expect(events.length).toBe(4);
    expect(events.at(-1)).toMatchObject({ table: 'student', rows: 2500, totalRows: 2500, doneRows: 2505, allRows: 2505 });
    // FK, UNIQUE, CHECK and the generated column exist for real
    const keys = await dump(res.database, "SELECT CONSTRAINT_TYPE AS t FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student'");
    expect(keys.map((k) => k.t).sort()).toEqual(['CHECK', 'CHECK', 'FOREIGN KEY', 'PRIMARY KEY', 'UNIQUE']);
    const gen = await dump(res.database, 'SELECT COUNT(*) AS bad FROM student WHERE twice <> year * 2');
    expect(Number(gen[0]!.bad)).toBe(0);
  });

  it('is deterministic for a given seed and different for another', async () => {
    const a = newId(); const b = newId(); const c = newId();
    await provision(a, school()); await provision(b, school());
    await provision(c, DesignDoc.parse({ ...school(), seed: 8 }));
    const q = 'SELECT MD5(GROUP_CONCAT(CONCAT_WS("|", reg_no, name, mail, dept_id, year, cgpa, label) ORDER BY student_id)) AS h FROM student';
    const [ha, hb, hc] = await Promise.all([dump(sandboxName(a), q), dump(sandboxName(b), q), dump(sandboxName(c), q)]);
    expect(ha[0]!.h).toBe(hb[0]!.h);
    expect(ha[0]!.h).not.toBe(hc[0]!.h);
    const sample = await dump(sandboxName(a), 'SELECT reg_no, mail, label FROM student ORDER BY student_id LIMIT 2');
    expect(sample[0]!.reg_no).toBe('24BCE0000');
    expect(sample[0]!.label).toBe(`S${(await dump(sandboxName(a), 'SELECT year FROM student ORDER BY student_id LIMIT 1'))[0]!.year}`);
    expect(String(sample[1]!.mail)).toMatch(/\.2@example\.edu$/);
  });

  it('applies rowScale and zipf/fkRef foreign keys stay valid', async () => {
    const id = newId();
    const d = school();
    d.schema.tables[1]!.columns.find((c) => c.name === 'dept_id')!.seed = { kind: 'fkRef', table: 'dept', column: 'dept_id', dist: 'zipf', s: 1.2 };
    const res = await provision(id, d, { rowScale: 0.1 });
    expect(res.rows).toBe(251); // dept round(0.5)=1, student 250
    const orphan = await dump(res.database, 'SELECT COUNT(*) AS n FROM student s LEFT JOIN dept d USING (dept_id) WHERE d.dept_id IS NULL');
    expect(Number(orphan[0]!.n)).toBe(0);
    const skew = await dump(res.database, 'SELECT dept_id, COUNT(*) AS n FROM student GROUP BY dept_id ORDER BY n DESC LIMIT 1');
    expect(Number(skew[0]!.dept_id)).toBe(1);
  });

  it('maps CHECK failures at seed time and DDL errors back to the offending table', async () => {
    const id = newId();
    const bad = school();
    bad.schema.tables[1]!.columns.find((c) => c.name === 'year')!.seed = { kind: 'uniformInt', min: 50, max: 60 };
    const err = await provision(id, bad).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(400);
    expect(err.extra).toMatchObject({ table: 'student' });
    expect(err.message).toMatch(/student/);

    const bad2 = school();
    bad2.schema.tables[1]!.checks.push({ expr: '`nonexistent_col` > 0' });
    const err2 = await provision(newId(), bad2).catch((e) => e);
    expect(err2).toBeInstanceOf(ServiceError);
    expect(err2.code).toBe('DDL_ERROR');
    expect(err2.extra).toMatchObject({ table: 'student' });
  });

  it('seeds 100k rows well under 20 seconds', async () => {
    const id = newId();
    const d = DesignDoc.parse({
      schema: { tables: [{
        name: 'big', primaryKey: ['id'], seedRows: 100_000,
        columns: [
          { name: 'id', type: int, autoIncrement: true }, { name: 'who', type: { kind: 'VARCHAR', length: 80 }, seed: { kind: 'personName' } },
          { name: 'n', type: int, seed: { kind: 'zipf', n: 1000, s: 1.1 } }, { name: 'amt', type: { kind: 'DECIMAL', precision: 10, scale: 2 }, seed: { kind: 'decimalRange', min: 0, max: 999, scale: 2 } },
          { name: 'tag', type: { kind: 'VARCHAR', length: 20 } },
        ],
      }] },
    });
    const res = await provision(id, d);
    expect(res.rows).toBe(100_000);
    console.log(`100k rows provisioned in ${res.ms} ms`);
    expect(res.ms).toBeLessThan(20_000);
  }, 60_000);
});
