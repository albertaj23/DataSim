import { describe, expect, it } from 'vitest';
import { DesignDoc, extractPlaceholders, validateDesign, type Transaction } from '@datasim/shared';
import {
  addVariant, bindsFromTest, deleteTransaction, renameTransaction, completionSchema, duplicateTransaction, formatPct, inlinePlaceholders, mixPercents, missingVariants, moveItem, newTransaction,
  normalizeWeights, placeholderCompletion, placeholderDiagnostics, removeVariant, renameParam, sampleParams, scanPlaceholders, scopeForStep, selectColumns,
  tablesIn, variantsOf, violationsOf,
} from './logic';

const design = () => DesignDoc.parse({
  schema: {
    tables: [
      { name: 'section', primaryKey: ['section_id'], columns: [{ name: 'section_id', type: { kind: 'INT' } }, { name: 'capacity', type: { kind: 'INT' } }, { name: 'enrolled', type: { kind: 'INT' } }] },
      { name: 'enrollment', primaryKey: ['student_id', 'section_id'], columns: [{ name: 'student_id', type: { kind: 'INT' } }, { name: 'section_id', type: { kind: 'INT' } }] },
    ],
  },
  workload: {
    transactions: [{
      name: 'register', weight: 55,
      params: { sid: { kind: 'uniformInt', min: 1, max: 10 }, stu: { kind: 'uniformInt', min: 1, max: 10 } },
      variants: {
        default: [
          { sql: 'SELECT enrolled, capacity AS cap FROM section WHERE section_id = :sid', bindAs: 's', guard: { left: '$s.enrolled', op: '<', right: '$s.cap', onFail: 'reject' } },
          { sql: 'UPDATE section SET enrolled = :$s.enrolled + 1 WHERE section_id = :sid', expectAffected: { op: '=', value: 1, onFail: 'retry' } },
        ],
      },
    }, { name: 'search', weight: 35, readOnly: true, params: {}, variants: { default: [{ sql: 'SELECT 1' }] } }, { name: 'mine', weight: 10, readOnly: true, params: {}, variants: { default: [{ sql: 'SELECT 2' }] } }],
  },
});
const txn = (d = design()): Transaction => d.workload.transactions[0]!;

describe('weights', () => {
  it('computes percentages', () => {
    const d = design();
    mixPercents(d.workload.transactions).forEach((p, i) => expect(p).toBeCloseTo([55, 35, 10][i]!, 9));
    expect(mixPercents([{ weight: 0 }])).toEqual([0]);
  });
  it('normalizes to whole percents summing to 100', () => {
    const t = [{ weight: 1 }, { weight: 1 }, { weight: 1 }];
    normalizeWeights(t);
    expect(t.map((x) => x.weight).reduce((a, b) => a + b, 0)).toBe(100);
    expect(t.map((x) => x.weight).sort()).toEqual([33, 33, 34]);
    const z = [{ weight: 0 }, { weight: 0 }];
    normalizeWeights(z);
    expect(z.map((x) => x.weight)).toEqual([0, 0]);
    const u = [{ weight: 5 }, { weight: 15 }];
    normalizeWeights(u);
    expect(u.map((x) => x.weight)).toEqual([25, 75]);
  });
  it('formats percentages compactly', () => {
    expect(formatPct(55)).toBe('55%');
    expect(formatPct(0.4)).toBe('<1%');
    expect(formatPct(12.5)).toBe('13%');
    expect(formatPct(3.33)).toBe('3.3%');
    expect(formatPct(0)).toBe('0%');
  });
});

describe('factories and variants', () => {
  it('creates a valid transaction with a unique name', () => {
    const d = design();
    const t = newTransaction(d);
    d.workload.transactions.push(t);
    expect(newTransaction(d).name).toBe('new_txn_2');
    expect(validateDesign(d).filter((p) => p.path.txn === 'new_txn')).toEqual([]);
  });
  it('duplicates with a fresh name and an independent copy', () => {
    const d = design();
    const c = duplicateTransaction(txn(d), d.workload.transactions.map((t) => t.name));
    expect(c.name).toBe('register_copy');
    c.variants.default![0]!.sql = 'changed';
    expect(txn(d).variants.default![0]!.sql).not.toBe('changed');
    expect(duplicateTransaction(c, ['register_copy']).name).toBe('register_copy_copy');
  });
  it('adds a variant as a copy of default and removes it again, but never removes default', () => {
    const t = txn();
    expect(variantsOf(t)).toEqual(['default']);
    addVariant(t, 'atomic');
    addVariant(t, 'naive');
    expect(variantsOf(t)).toEqual(['default', 'naive', 'atomic']);
    expect(missingVariants(t)).toEqual(['pessimistic', 'optimistic', 'serializable']);
    expect(t.variants.atomic).toEqual(t.variants.default);
    expect(t.variants.atomic![0]).not.toBe(t.variants.default![0]);
    expect(removeVariant(t, 'atomic')).toBe(true);
    expect(removeVariant(t, 'default')).toBe(false);
    expect(variantsOf(t)).toEqual(['default', 'naive']);
  });
  it('moves items', () => {
    const l = ['a', 'b', 'c'];
    moveItem(l, 0, 2); expect(l).toEqual(['b', 'c', 'a']);
    moveItem(l, 2, 5); expect(l).toEqual(['b', 'c', 'a']);
    moveItem(l, 1, 0); expect(l).toEqual(['c', 'b', 'a']);
  });
});

describe('rename and delete', () => {
  it('moves the per-transaction SLO with the name', () => {
    const d = design();
    d.slo.perTxn = { register: 150 };
    renameTransaction(d, 'register', 'signup');
    expect(d.workload.transactions[0]!.name).toBe('signup');
    expect(d.slo.perTxn).toEqual({ signup: 150 });
    deleteTransaction(d, 'signup');
    expect(d.workload.transactions.map((t) => t.name)).toEqual(['search', 'mine']);
    expect(d.slo.perTxn).toEqual({});
  });
});

describe('placeholder scanning and diagnostics', () => {
  const samples = [
    'SELECT * FROM t WHERE a = :a AND b = :$s.x',
    "SELECT ':notparam' AS x, 'a:b' FROM t WHERE c = :c",
    'SELECT `col:1` FROM t WHERE d = :d::int',
    'UPDATE t SET a = :$bind.col, b = :p WHERE id = :p',
    'SELECT 10:30',
  ];
  it('finds the same names as the shared extractPlaceholders', () => {
    for (const sql of samples) {
      const hits = scanPlaceholders(sql);
      const shared = extractPlaceholders(sql);
      expect([...new Set(hits.filter((h) => h.kind === 'param').map((h) => h.name))].sort()).toEqual([...shared.params].sort());
      expect(hits.filter((h) => h.kind === 'bind').map((h) => `${h.name}.${h.col}`)).toEqual(shared.binds.map((b) => `${b.name}.${b.col}`));
    }
  });
  it('reports offsets that slice back to the placeholder', () => {
    const sql = 'SELECT 1 WHERE a = :abc AND b = :$s.x';
    for (const h of scanPlaceholders(sql)) expect(sql.slice(h.from, h.to)).toMatch(/^:/);
    expect(scanPlaceholders(sql).map((h) => sql.slice(h.from, h.to))).toEqual([':abc', ':$s.x']);
  });
  it('flags unknown params, unbound binds and unknown bind columns', () => {
    const scope = { params: ['sid'], binds: [{ name: 's', columns: ['enrolled', 'cap'] }] };
    expect(placeholderDiagnostics('SELECT :sid, :$s.enrolled', scope)).toEqual([]);
    expect(placeholderDiagnostics('SELECT :nope', scope).map((d) => d.message)).toEqual(['Unknown parameter :nope']);
    expect(placeholderDiagnostics('SELECT :$t.x', scope)[0]!.message).toMatch(/not bound/);
    expect(placeholderDiagnostics('SELECT :$s.zzz', scope)[0]!.message).toMatch(/no column zzz/);
    expect(placeholderDiagnostics("SELECT ':nope'", scope)).toEqual([]);
    // columns unknown (select *): any column accepted
    expect(placeholderDiagnostics('SELECT :$s.anything', { params: [], binds: [{ name: 's', columns: [] }] })).toEqual([]);
  });
  it('agrees with validateDesign on the unknown-param / unbound-bind verdict', () => {
    const d = design();
    const t = txn(d);
    t.variants.default![1]!.sql = 'UPDATE section SET enrolled = :$x.enrolled + :missing WHERE section_id = :sid';
    const codes = validateDesign(d).filter((p) => p.path.txn === 'register').map((p) => p.code).sort();
    expect(codes).toEqual(['UNKNOWN_BIND', 'UNKNOWN_PARAM']);
    const scope = scopeForStep(t, t.variants.default!, 1, d.schema);
    expect(placeholderDiagnostics(t.variants.default![1]!.sql, scope).map((x) => x.kind).sort()).toEqual(['bind', 'param']);
  });
  it('renames a param in SQL, guards and the params map without touching literals', () => {
    const t = txn();
    t.variants.default![0]!.sql = "SELECT ':sid' AS lit, enrolled FROM section WHERE section_id = :sid";
    t.variants.default![0]!.guard = { left: ':sid', op: '>', right: '0', onFail: 'reject' };
    renameParam(t, 'sid', 'section');
    expect(t.variants.default![0]!.sql).toBe("SELECT ':sid' AS lit, enrolled FROM section WHERE section_id = :section");
    expect(t.variants.default![1]!.sql).toContain(':section');
    expect(t.variants.default![0]!.guard!.left).toBe(':section');
    expect(Object.keys(t.params)).toEqual(['section', 'stu']);
  });
});

describe('SQL completion', () => {
  const d = design();
  it('builds the lang-sql schema from tables and columns', () => {
    expect(completionSchema(d.schema)).toEqual({ section: ['section_id', 'capacity', 'enrolled'], enrollment: ['student_id', 'section_id'] });
  });
  it('lists tables and select columns of a statement', () => {
    const cs = completionSchema(d.schema);
    expect(tablesIn('SELECT * FROM section s JOIN `enrollment` e ON e.section_id = s.section_id')).toEqual(['section', 'enrollment']);
    expect(selectColumns('SELECT enrolled, capacity AS cap, COUNT(*) n, s.section_id FROM section s', cs)).toEqual(['enrolled', 'cap', 'n', 'section_id']);
    expect(selectColumns('SELECT * FROM section', cs)).toEqual(['section_id', 'capacity', 'enrolled']);
    expect(selectColumns("SELECT 'a, b' AS x, f(a, b) AS y FROM t", cs)).toEqual(['x', 'y']);
  });
  it('derives step scope: params plus earlier binds only', () => {
    const t = txn(d);
    const steps = t.variants.default!;
    expect(scopeForStep(t, steps, 0, d.schema)).toEqual({ params: ['sid', 'stu'], binds: [] });
    expect(scopeForStep(t, steps, 1, d.schema)).toEqual({ params: ['sid', 'stu'], binds: [{ name: 's', columns: ['enrolled', 'cap'] }] });
  });
  it('completes params, binds and bind columns', () => {
    const scope = { params: ['sid', 'stu'], binds: [{ name: 's', columns: ['enrolled', 'cap'] }] };
    expect(placeholderCompletion('SELECT * FROM t WHERE a = :', scope)).toEqual({ from: 27, options: [{ label: 'sid', detail: 'parameter' }, { label: 'stu', detail: 'parameter' }] });
    expect(placeholderCompletion('a = :si', scope)!.from).toBe(5);
    expect(placeholderCompletion('a = :$', scope)).toEqual({ from: 5, options: [{ label: '$s', detail: 'bound by an earlier step' }] });
    expect(placeholderCompletion('a = :$s.', scope)!.options.map((o) => o.label)).toEqual(['enrolled', 'cap']);
    expect(placeholderCompletion('a = :$s.en', scope)!.from).toBe(8);
    expect(placeholderCompletion('a = :$zz.', scope)).toBeNull();
    expect(placeholderCompletion('SELECT a::int', scope)).toBeNull();
    expect(placeholderCompletion('SELECT 10:3', scope)).toBeNull();
    expect(placeholderCompletion('SELECT a', scope)).toBeNull();
  });
});

describe('EXPLAIN inlining', () => {
  it('inlines params and binds as SQL literals', () => {
    const sql = "SELECT * FROM t WHERE a = :a AND b = :b AND c = :$s.x AND d = ':keep' AND e = :missing";
    expect(inlinePlaceholders(sql, { a: 5, b: "o'k\\" }, { s: { x: 7.5 } })).toBe("SELECT * FROM t WHERE a = 5 AND b = 'o''k\\\\' AND c = 7.5 AND d = ':keep' AND e = NULL");
    expect(inlinePlaceholders('SELECT :t, :f, :n', { t: true, f: false, n: null }, {})).toBe('SELECT 1, 0, NULL');
  });
  it('samples one value per param deterministically; fromTable falls back to 1', () => {
    const d = design();
    const t = txn(d);
    t.params.k = { kind: 'fromTable', table: 'section', column: 'section_id', dist: 'uniform', s: 1.1 };
    const a = sampleParams(t, 42);
    expect(a.k).toBe(1);
    expect(typeof a.sid).toBe('number');
    expect(sampleParams(t, 42)).toEqual(a);
  });
  it('reads binds from the rows of a Test once response', () => {
    const t = txn();
    const res = { txnName: 'register', variant: 'default', params: {}, outcome: 'COMMITTED_THEN_ROLLED_BACK' as const, steps: [{ index: 0, sql: '', rows: [{ enrolled: 3, cap: 60 }], rowCount: 1, affected: null, ms: 1 }, { index: 1, sql: '', rows: [], rowCount: 1, affected: 1, ms: 1 }] };
    expect(bindsFromTest(t.variants.default!, res)).toEqual({ s: { enrolled: 3, cap: 60 } });
  });
});

describe('invariant results', () => {
  it('reads violations from the named column or the first column', () => {
    expect(violationsOf({ columns: ['violations'], rows: [[3]], truncated: false, ms: 1 })).toBe(3);
    expect(violationsOf({ columns: ['x', 'Violations'], rows: [[9, 0]], truncated: false, ms: 1 })).toBe(0);
    expect(violationsOf({ columns: ['COUNT(*)'], rows: [['2']], truncated: false, ms: 1 })).toBe(2);
    expect(violationsOf({ columns: ['violations'], rows: [], truncated: false, ms: 1 })).toBeNull();
    expect(violationsOf({ columns: ['v'], rows: [['x']], truncated: false, ms: 1 })).toBeNull();
  });
});
