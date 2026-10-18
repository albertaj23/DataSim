import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { generateDdl } from '@datasim/shared';
import { createApp } from '../../src/app.js';
import { appPool, closePools } from '../../src/db/pool.js';
import { buildTemplate, TEMPLATES } from '../../src/templates/index.js';
import { checkStatements, splitStatements } from '../../src/projects/importDdl.js';

const app = createApp();
afterAll(closePools);

describe('POST /api/schema/import', () => {
  it('turns pasted DDL into a SchemaModel', async () => {
    const ddl = `
      -- two tables
      CREATE TABLE Dept (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(8) NOT NULL UNIQUE, name VARCHAR(80));
      CREATE TABLE emp (
        id INT AUTO_INCREMENT PRIMARY KEY, dept_id INT NOT NULL, salary DECIMAL(10,2) NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT TRUE, kind ENUM('FT','PT') NOT NULL, born DATE NULL,
        created DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), bonus DECIMAL(10,2) AS (salary * 0.1) STORED,
        CONSTRAINT fk_emp_dept FOREIGN KEY (dept_id) REFERENCES Dept(id) ON DELETE CASCADE,
        CONSTRAINT ck_salary CHECK (salary >= 0), INDEX ix_emp_kind (kind, born)
      );`;
    const res = await request(app).post('/api/schema/import').send({ ddl });
    expect(res.status).toBe(200);
    const byName = Object.fromEntries((res.body.schema.tables as Array<{ name: string }>).map((t) => [t.name, t])) as Record<string, any>;
    expect(Object.keys(byName).sort()).toEqual(['dept', 'emp']);
    expect(res.body.warnings.join(' ')).toMatch(/lowercase/);
    expect(byName.dept.primaryKey).toEqual(['id']);
    expect(byName.dept.columns[0]).toMatchObject({ autoIncrement: true, type: { kind: 'INT' } });
    expect(byName.dept.uniques[0].columns).toEqual(['code']);
    const emp = byName.emp;
    expect(emp.foreignKeys[0]).toMatchObject({ columns: ['dept_id'], refTable: 'dept', refColumns: ['id'], onDelete: 'CASCADE' });
    expect(emp.indexes).toEqual([{ name: 'ix_emp_kind', columns: ['kind', 'born'], unique: false }]);
    expect(emp.checks[0].expr).toMatch(/salary/);
    const types = Object.fromEntries(emp.columns.map((c: any) => [c.name, c]));
    expect(types.active.type.kind).toBe('BOOLEAN');
    expect(types.kind.type).toEqual({ kind: 'ENUM', values: ['FT', 'PT'] });
    expect(types.salary.type).toMatchObject({ kind: 'DECIMAL', precision: 10, scale: 2 });
    expect(types.bonus.generated).toBeTruthy();
    // the imported model regenerates DDL that MySQL accepts
    const regen = await request(app).post('/api/schema/ddl').send(res.body.schema);
    expect(regen.body.statements).toHaveLength(2);
  });

  it('round-trips a template: DDL -> import -> same tables, keys and FKs', async () => {
    for (const t of TEMPLATES) {
      const original = buildTemplate(t.key).schema;
      const res = await request(app).post('/api/schema/import').send({ ddl: generateDdl(original).sql });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const got = res.body.schema.tables as typeof original.tables;
      expect(got.map((x) => x.name).sort()).toEqual(original.tables.map((x) => x.name).sort());
      for (const o of original.tables) {
        const g = got.find((x) => x.name === o.name)!;
        expect(g.primaryKey).toEqual(o.primaryKey);
        expect(g.foreignKeys.map((f) => f.columns.join()).sort()).toEqual(o.foreignKeys.map((f) => f.columns.join()).sort());
        expect(g.columns.map((c) => c.name)).toEqual(o.columns.map((c) => c.name));
      }
      // and the imported model's DDL applies again
      expect((await request(app).post('/api/schema/ddl').send(res.body.schema)).body.statements.length).toBe(original.tables.length);
    }
  });

  it('reports MySQL errors, rejects non-table DDL and qualified names, and leaves nothing behind', async () => {
    const bad = await request(app).post('/api/schema/import').send({ ddl: 'CREATE TABLE t (id INT, id INT);' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('DDL_REJECTED');
    expect(bad.body.message).toMatch(/Statement 1/);
    expect((await request(app).post('/api/schema/import').send({ ddl: 'DROP DATABASE datasim' })).body.message).toMatch(/Only CREATE TABLE/);
    expect((await request(app).post('/api/schema/import').send({ ddl: 'CREATE TABLE datasim.x (id INT)' })).body.message).toMatch(/Qualified names/);
    const [rows] = await appPool.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?', ['dsim\\_scratch\\_%']);
    expect(rows).toEqual([]);
  });

  it('splits statements outside quotes and comments', () => {
    expect(splitStatements("CREATE TABLE a (x VARCHAR(3) DEFAULT ';'); -- c;\n/* ; */ CREATE TABLE b (y INT);")).toHaveLength(2);
    expect(checkStatements(['CREATE TABLE a (d DECIMAL(3,1) DEFAULT 1.5)'])).toBeNull();
  });
});

describe('POST /api/normalize', () => {
  it('analyses text FDs', async () => {
    const res = await request(app).post('/api/normalize').send({ attributes: ['A', 'B', 'C', 'D'], fds: 'A -> B\nB -> C\nC -> D', closureOf: ['B'] });
    expect(res.status).toBe(200);
    expect(res.body.highestNormalForm).toBe('2NF');
    expect(res.body.closure).toEqual(['B', 'C', 'D']);
    expect(res.body.bcnf.relations).toHaveLength(3);
  });
  it('400s on unknown attributes', async () => {
    const res = await request(app).post('/api/normalize').send({ attributes: ['A'], fds: [{ lhs: ['A'], rhs: ['Z'] }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_FDS');
  });
});
