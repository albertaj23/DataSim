import { describe, expect, it } from 'vitest';
import { generateDdl, normalize, parseFds, type DesignDoc, type SchemaModel, type Table } from '@datasim/shared';
import { applyDecomposition, guessType, previewDecomposition, toIdent, workloadMentions } from './applyDecomposition';

const col = (name: string, kind: 'INT' | 'VARCHAR' = 'VARCHAR', nullable = false) => ({
  name, nullable, autoIncrement: false,
  type: kind === 'INT' ? ({ kind: 'INT', unsigned: false } as const) : ({ kind: 'VARCHAR', length: 40 } as const),
});
const flat = (): Table => ({
  name: 'enrol_flat',
  columns: [col('student_id', 'INT'), col('course_id', 'INT'), col('grade'), col('dept'), col('dept_head')],
  primaryKey: ['student_id', 'course_id'], uniques: [], indexes: [], foreignKeys: [], checks: [], seedRows: 500, position: { x: 100, y: 40 },
});
const attrs = ['student_id', 'course_id', 'grade', 'dept', 'dept_head'];
const fds = 'student_id, course_id -> grade; student_id -> dept; dept -> dept_head';

describe('applyDecomposition', () => {
  it('replaces a flat table with BCNF tables, keeping types and wiring FKs', () => {
    const schema: SchemaModel = { tables: [flat()] };
    const r = normalize(attrs, parseFds(fds));
    const res = applyDecomposition(schema, { sourceTable: 'enrol_flat', fragments: r.bcnf.relations });
    expect(res.removed).toBe('enrol_flat');
    expect(schema.tables.length).toBe(r.bcnf.relations.length);
    expect(schema.tables.map((t) => t.name)).toContain('enrol_flat'); // the table holding the old key keeps its name
    const main = schema.tables.find((t) => t.name === 'enrol_flat')!;
    expect(main.primaryKey).toEqual(['student_id', 'course_id']);
    expect(main.columns.find((c) => c.name === 'student_id')!.type).toEqual({ kind: 'INT', unsigned: false });
    const dept = schema.tables.find((t) => t.columns.some((c) => c.name === 'dept_head'))!;
    expect(dept.primaryKey).toEqual(['dept']);
    // every foreign key points at a real table whose key it references
    for (const t of schema.tables) for (const fk of t.foreignKeys) {
      const p = schema.tables.find((x) => x.name === fk.refTable)!;
      expect(p).toBeTruthy();
      expect(p.primaryKey).toEqual(fk.refColumns);
    }
    expect(schema.tables.reduce((n, t) => n + t.foreignKeys.length, 0)).toBeGreaterThan(0);
    expect(() => generateDdl(schema)).not.toThrow();
    expect(schema.tables.every((t) => t.position)).toBe(true);
  });

  it('3NF synthesis also yields valid DDL, with parents seeded smaller than children', () => {
    const schema: SchemaModel = { tables: [flat()] };
    applyDecomposition(schema, { sourceTable: 'enrol_flat', fragments: normalize(attrs, parseFds(fds)).threeNf.relations });
    const dept = schema.tables.find((t) => t.columns.some((c) => c.name === 'dept_head'))!;
    expect(dept.seedRows).toBeLessThan(500);
    expect(generateDdl(schema).sql).toContain('FOREIGN KEY');
  });

  it('can keep the source table and add the new ones', () => {
    const schema: SchemaModel = { tables: [flat()] };
    const res = applyDecomposition(schema, { sourceTable: 'enrol_flat', fragments: normalize(attrs, parseFds(fds)).bcnf.relations, replaceSource: false });
    expect(res.removed).toBeNull();
    expect(schema.tables.length).toBe(1 + res.created.length);
    expect(new Set(schema.tables.map((t) => t.name)).size).toBe(schema.tables.length);
  });

  it('creates tables for a universal relation, guessing types', () => {
    const schema: SchemaModel = { tables: [] };
    const r = normalize(['StudentID', 'Course', 'Instructor'], parseFds('StudentID, Course -> Instructor; Instructor -> Course'));
    const res = applyDecomposition(schema, { sourceTable: null, fragments: r.bcnf.relations });
    expect(res.removed).toBeNull();
    expect(schema.tables.length).toBe(2);
    const all = schema.tables.flatMap((t) => t.columns);
    expect(all.find((c) => c.name === 'student_id')!.type.kind).toBe('INT');
    expect(all.find((c) => c.name === 'course')!.type).toEqual({ kind: 'VARCHAR', length: 80 });
    expect(() => generateDdl(schema)).not.toThrow();
  });

  it('repoints foreign keys of other tables that referenced the source', () => {
    const child: Table = {
      name: 'note', columns: [col('note_id', 'INT'), col('student_id', 'INT')], primaryKey: ['note_id'], uniques: [], indexes: [], checks: [], seedRows: 10,
      foreignKeys: [{ columns: ['student_id'], refTable: 'enrol_flat', refColumns: ['student_id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }],
    };
    const schema: SchemaModel = { tables: [flat(), child] };
    const res = applyDecomposition(schema, { sourceTable: 'enrol_flat', fragments: normalize(attrs, parseFds(fds)).bcnf.relations });
    const fk = schema.tables.find((t) => t.name === 'note')!.foreignKeys;
    // student_id is the key of the (student_id, dept) table, so the FK follows it there
    expect(fk.length).toBe(1);
    const target = schema.tables.find((t) => t.name === fk[0]!.refTable)!;
    expect(target.primaryKey).toEqual(['student_id']);
    expect(res.warnings).toEqual([]);
  });

  it('preview does not touch the input; a vanished table is rejected', () => {
    const schema: SchemaModel = { tables: [flat()] };
    const before = JSON.stringify(schema);
    previewDecomposition(schema, { sourceTable: 'enrol_flat', fragments: normalize(attrs, parseFds(fds)).bcnf.relations });
    expect(JSON.stringify(schema)).toBe(before);
    expect(() => applyDecomposition(schema, { sourceTable: 'missing', fragments: normalize(attrs, parseFds(fds)).bcnf.relations })).toThrow(/no longer exists/);
  });
});

describe('helpers', () => {
  it('toIdent and guessType', () => {
    expect(toIdent('StudentID')).toBe('student_id');
    expect(toIdent('A')).toBe('a');
    expect(toIdent('1st col')).toBe('c_1st_col');
    expect(guessType('dept_id').kind).toBe('INT');
    expect(guessType('price').kind).toBe('DECIMAL');
    expect(guessType('Name').kind).toBe('VARCHAR');
  });
  it('workloadMentions finds transactions and invariants using a table', () => {
    const design = {
      workload: {
        transactions: [
          { name: 'q', weight: 1, readOnly: true, cacheable: false, description: '', params: {}, variants: { default: [{ sql: 'SELECT * FROM `enrol_flat` WHERE 1' }] } },
          { name: 'z', weight: 1, readOnly: true, cacheable: false, description: '', params: {}, variants: { default: [{ sql: 'SELECT 1 FROM enrol_flat_x' }] } },
        ],
        invariants: [{ name: 'inv', description: '', sql: 'SELECT COUNT(*) FROM enrol_flat' }],
      },
    } as unknown as Pick<DesignDoc, 'workload'>;
    expect(workloadMentions(design, 'enrol_flat')).toEqual(['q', 'invariant inv']);
  });
});
