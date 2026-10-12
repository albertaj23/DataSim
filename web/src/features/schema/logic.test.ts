import { describe, expect, it } from 'vitest';
import { DesignDoc, generateDdl, validateDesign } from '@datasim/shared';
import {
  addForeignKey, countIdent, defaultType, deleteColumn, deleteTable, findTableInMessage, fkEdges, formatDefault, identError, mergeProblems,
  newColumn, newTable, parseDefault, renameColumn, renameTable, replaceIdent, scaledRows, setColumnKind, sqlMentions, toggleAutoIncrement, togglePk, toggleUnique, uniqueName,
} from './logic';

const design = (): DesignDoc => DesignDoc.parse({
  schema: {
    tables: [
      {
        name: 'course', primaryKey: ['course_id'], seedRows: 10,
        columns: [{ name: 'course_id', type: { kind: 'INT' }, autoIncrement: true }, { name: 'title', type: { kind: 'VARCHAR', length: 80 } }],
        checks: [{ expr: 'LENGTH(title) > 0' }],
      },
      {
        name: 'section', primaryKey: ['section_id'], seedRows: 50,
        columns: [
          { name: 'section_id', type: { kind: 'INT' }, autoIncrement: true },
          { name: 'course_id', type: { kind: 'INT' }, seed: { kind: 'fkRef', table: 'course', column: 'course_id', dist: 'uniform', s: 1.1 } },
          { name: 'label', type: { kind: 'VARCHAR', length: 8 }, seed: { kind: 'email', from: 'title', domain: 'x.edu' } },
        ],
        uniques: [{ columns: ['section_id', 'course_id'] }],
        indexes: [{ name: 'ix_course', columns: ['course_id'] }],
        foreignKeys: [{ columns: ['course_id'], refTable: 'course', refColumns: ['course_id'], onDelete: 'CASCADE', onUpdate: 'RESTRICT' }],
      },
    ],
  },
  workload: {
    transactions: [{
      name: 'search', weight: 1, params: { cid: { kind: 'fromTable', table: 'course', column: 'course_id', dist: 'uniform', s: 1.1 } },
      variants: { default: [{ sql: 'SELECT * FROM section WHERE course_id = :cid' }] },
    }],
    invariants: [{ name: 'inv', sql: "SELECT COUNT(*) AS violations FROM course WHERE title = 'course'" }],
  },
});

describe('identifiers', () => {
  it('validates names', () => {
    expect(identError('')).toBe('Required');
    expect(identError('Bad')).toMatch(/Lowercase/);
    expect(identError('1abc')).toMatch(/Lowercase/);
    expect(identError('a'.repeat(65))).toMatch(/64/);
    expect(identError('ok_1', ['ok_1'])).toBe('Already used');
    expect(identError('ok_2', ['ok_1'])).toBeNull();
  });
  it('makes unique names', () => {
    expect(uniqueName('t', ['a'])).toBe('t');
    expect(uniqueName('t', ['t', 't_2'])).toBe('t_3');
  });
});

describe('factories', () => {
  it('creates a valid table with a unique name and a PK', () => {
    const d = design();
    const t = newTable(d.schema, { x: 1, y: 2 });
    d.schema.tables.push(t);
    d.schema.tables.push(newTable(d.schema));
    expect(d.schema.tables.map((x) => x.name).slice(2)).toEqual(['new_table', 'new_table_2']);
    expect(t.primaryKey).toEqual(['id']);
    expect(validateDesign(d).filter((p) => p.path.table === 'new_table')).toEqual([]);
    expect(() => generateDdl(d.schema)).not.toThrow();
  });
  it('creates uniquely named columns', () => {
    const t = design().schema.tables[0]!;
    const a = newColumn(t); t.columns.push(a);
    expect(a.name).toBe('column');
    expect(newColumn(t).name).toBe('column_2');
  });
  it('switches kinds and keeps compatible parameters', () => {
    const c = { name: 'a', type: { kind: 'VARCHAR' as const, length: 33 }, nullable: false, autoIncrement: false, default: 'x' };
    setColumnKind(c, 'CHAR');
    expect(c.type).toEqual({ kind: 'CHAR', length: 33 });
    expect(c.default).toBeUndefined();
    const i = { name: 'b', type: { kind: 'INT' as const, unsigned: true }, nullable: false, autoIncrement: true };
    setColumnKind(i, 'BIGINT');
    expect(i.type).toEqual({ kind: 'BIGINT', unsigned: true });
    setColumnKind(i, 'TEXT');
    expect(i.autoIncrement).toBe(false);
    expect(defaultType('DECIMAL')).toEqual({ kind: 'DECIMAL', precision: 10, scale: 2 });
  });
});

describe('rename propagation', () => {
  it('renames a table in FKs, seed refs and workload params', () => {
    const d = design();
    renameTable(d, 'course', 'class');
    expect(d.schema.tables[0]!.name).toBe('class');
    expect(d.schema.tables[1]!.foreignKeys[0]!.refTable).toBe('class');
    expect(d.schema.tables[1]!.columns[1]!.seed).toMatchObject({ kind: 'fkRef', table: 'class' });
    expect(d.workload.transactions[0]!.params.cid).toMatchObject({ table: 'class' });
    expect(validateDesign(d).filter((p) => p.code.startsWith('FK_') || p.code === 'SEED_FKREF')).toEqual([]);
  });
  it('renames a column everywhere it is referenced', () => {
    const d = design();
    renameColumn(d, 'course', 'course_id', 'cid');
    const [course, section] = d.schema.tables;
    expect(course!.columns[0]!.name).toBe('cid');
    expect(course!.primaryKey).toEqual(['cid']);
    expect(section!.foreignKeys[0]!.refColumns).toEqual(['cid']);
    expect(section!.foreignKeys[0]!.columns).toEqual(['course_id']);
    expect(section!.columns[1]!.seed).toMatchObject({ column: 'cid' });
    expect(d.workload.transactions[0]!.params.cid).toMatchObject({ column: 'cid' });
    expect(validateDesign(d).filter((p) => p.path.table)).toEqual([]);
  });
  it('renames a child column in PK, uniques, indexes, FK columns, checks and email source', () => {
    const d = design();
    renameColumn(d, 'section', 'course_id', 'crs');
    const s = d.schema.tables[1]!;
    expect(s.uniques[0]!.columns).toEqual(['section_id', 'crs']);
    expect(s.indexes[0]!.columns).toEqual(['crs']);
    expect(s.foreignKeys[0]!.columns).toEqual(['crs']);
    renameColumn(d, 'course', 'title', 'name');
    expect(d.schema.tables[0]!.checks[0]!.expr).toBe('LENGTH(name) > 0');
    expect(d.schema.tables[1]!.columns[2]!.seed).toMatchObject({ kind: 'email', from: 'title' }); // different table: untouched
    renameColumn(d, 'section', 'label', 'tag');
    expect(validateDesign(d).filter((p) => p.path.table)).toEqual([]);
  });
  it('rewrites identifiers only outside string literals', () => {
    expect(replaceIdent("a > 1 AND b = 'a' AND `a` < 3", 'a', 'z')).toBe("z > 1 AND b = 'a' AND `z` < 3");
    expect(replaceIdent('abc + a', 'a', 'z')).toBe('abc + z');
  });
  it('counts workload SQL that mentions a name', () => {
    const d = design();
    expect(countIdent("SELECT section FROM section WHERE x = 'section'", 'section')).toBe(2);
    expect(sqlMentions(d, 'section')).toBe(1);
    expect(sqlMentions(d, 'course')).toBe(1);
    expect(sqlMentions(d, 'nothing')).toBe(0);
  });
});

describe('delete', () => {
  it('deleting a column drops dependent constraints, FKs on both sides and seed refs', () => {
    const d = design();
    deleteColumn(d, 'section', 'course_id');
    const s = d.schema.tables[1]!;
    expect(s.columns.map((c) => c.name)).toEqual(['section_id', 'label']);
    expect(s.uniques).toEqual([]);
    expect(s.indexes).toEqual([]);
    expect(s.foreignKeys).toEqual([]);
    const d2 = design();
    deleteColumn(d2, 'course', 'course_id');
    expect(d2.schema.tables[0]!.primaryKey).toEqual(['title']); // never left without a key
    expect(d2.schema.tables[0]!.columns[0]!.nullable).toBe(false);
    expect(d2.schema.tables[1]!.foreignKeys).toEqual([]);
    expect(d2.schema.tables[1]!.columns[1]!.seed).toBeUndefined();
  });
  it('deleting a table removes inbound FKs and fkRef seeds', () => {
    const d = design();
    deleteTable(d, 'course');
    expect(d.schema.tables.map((t) => t.name)).toEqual(['section']);
    expect(d.schema.tables[0]!.foreignKeys).toEqual([]);
    expect(d.schema.tables[0]!.columns[1]!.seed).toBeUndefined();
    expect(validateDesign(d).filter((p) => p.path.table)).toEqual([]);
  });
});

describe('keeping the model valid', () => {
  it('never deletes the last column or removes the last key column', () => {
    const d = design();
    const t = d.schema.tables[0]!;
    deleteColumn(d, 'course', 'title');
    deleteColumn(d, 'course', 'course_id');
    expect(t.columns.map((c) => c.name)).toEqual(['course_id']);
    togglePk(t, 'course_id');
    expect(t.primaryKey).toEqual(['course_id']);
  });
});

describe('flags', () => {
  it('toggles PK, unique and auto increment consistently', () => {
    const t = newTable({ tables: [] });
    t.columns.push({ name: 'code', type: defaultType('VARCHAR'), nullable: true, autoIncrement: false });
    togglePk(t, 'code');
    expect(t.primaryKey).toEqual(['id', 'code']);
    expect(t.columns[1]!.nullable).toBe(false);
    togglePk(t, 'id');
    expect(t.primaryKey).toEqual(['code']);
    expect(t.columns[0]!.autoIncrement).toBe(false);
    toggleUnique(t, 'code');
    expect(t.uniques).toEqual([{ columns: ['code'] }]);
    toggleUnique(t, 'code');
    expect(t.uniques).toEqual([]);
    toggleAutoIncrement(t, 'code'); // not an integer
    expect(t.columns[1]!.autoIncrement).toBe(false);
    toggleAutoIncrement(t, 'id');
    expect(t.columns[0]!.autoIncrement).toBe(true);
  });
});

describe('defaults', () => {
  const vc = { kind: 'VARCHAR', length: 10 } as const;
  const int = { kind: 'INT', unsigned: false } as const;
  it('parses and formats', () => {
    expect(parseDefault('', int)).toBeUndefined();
    expect(parseDefault('NULL', int)).toBeNull();
    expect(parseDefault('42', int)).toBe(42);
    expect(parseDefault('42', vc)).toBe('42');
    expect(parseDefault("'it''s'", vc)).toBe("it's");
    expect(parseDefault('CURRENT_TIMESTAMP(3)', { kind: 'DATETIME' })).toEqual({ expr: 'CURRENT_TIMESTAMP(3)' });
    expect(parseDefault('(UUID())', vc)).toEqual({ expr: 'UUID()' });
    expect(parseDefault('false', { kind: 'BOOLEAN' })).toBe(false);
    expect(parseDefault(formatDefault(5), int)).toBe(5);
    expect(parseDefault(formatDefault(null), vc)).toBeNull();
    expect(parseDefault(formatDefault('abc'), vc)).toBe('abc');
    expect(parseDefault(formatDefault(true), { kind: 'BOOLEAN' })).toBe(true);
    expect(parseDefault(formatDefault({ expr: 'UUID()' }), vc)).toEqual({ expr: 'UUID()' });
    expect(parseDefault(formatDefault({ expr: 'CURRENT_TIMESTAMP(3)' }), { kind: 'DATETIME' })).toEqual({ expr: 'CURRENT_TIMESTAMP(3)' });
  });
});

describe('foreign keys', () => {
  it('derives ER edges with cardinality', () => {
    const d = design();
    const e = fkEdges(d.schema);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ from: 'section', to: 'course', fromCol: 'course_id', toCol: 'course_id', childIsOne: false });
    d.schema.tables[1]!.uniques.push({ columns: ['course_id'] });
    expect(fkEdges(d.schema)[0]!.childIsOne).toBe(true);
  });
  it('adds an FK only to a referenceable column and not twice', () => {
    const d = design();
    d.schema.tables[0]!.foreignKeys = [];
    d.schema.tables[1]!.foreignKeys = [];
    expect(addForeignKey(d.schema, 'section', 'course_id', 'course', 'title')).toMatch(/PRIMARY KEY or UNIQUE/);
    expect(addForeignKey(d.schema, 'section', 'course_id', 'course', 'course_id')).toBeNull();
    expect(addForeignKey(d.schema, 'section', 'course_id', 'course', 'course_id')).toMatch(/already/);
    expect(d.schema.tables[1]!.foreignKeys).toHaveLength(1);
  });
});

describe('misc', () => {
  it('scales row counts', () => {
    expect(scaledRows(1000, 0.1)).toBe(100);
    expect(scaledRows(3, 0.1)).toBe(1);
    expect(scaledRows(0, 10)).toBe(0);
    expect(scaledRows(1_500_000, 10)).toBe(2_000_000);
  });
  it('merges problems without duplicates', () => {
    const p = { severity: 'error' as const, code: 'X', message: 'm', path: { table: 't' } };
    expect(mergeProblems([p], [{ ...p }])).toHaveLength(1);
  });
  it('finds the table named in a MySQL error', () => {
    expect(findTableInMessage("Table 'dsim_ab12.enrollment' doesn't exist", ['student', 'enrollment', 'enroll'])).toBe('enrollment');
    expect(findTableInMessage('Cannot add foreign key constraint', ['student'])).toBeNull();
    expect(findTableInMessage('Check constraint `ck_section_1` is violated on `section`', ['section', 'sec'])).toBe('section');
  });
});
