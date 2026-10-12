// Step compilation and execution shared by the load runner and "Test once".
// mysql2 named placeholders cannot express `:$s.col`, so every `:name` / `:$bind.col` is rewritten to a positional `?`
// and resolved from params / bound rows at execution time. Values are always bound (client-side escaped), never concatenated.
import type { Step, Value } from '@datasim/shared';
import { hr, msSince } from './util.js';

export type Slot = { k: 'p'; name: string } | { k: 'b'; bind: string; col: string };
export interface CompiledSql { text: string; slots: Slot[] }

const TOKEN = /'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"|`[^`]*`|(?<!:):(\$([A-Za-z_]\w*)\.(\w+)|([A-Za-z_]\w*))/g;

export function compileSql(sql: string): CompiledSql {
  const slots: Slot[] = [];
  const text = sql.replace(TOKEN, (m, whole: string | undefined, bind: string | undefined, col: string | undefined, name: string | undefined) => {
    if (whole === undefined) return m;
    slots.push(bind ? { k: 'b', bind, col: col! } : { k: 'p', name: name! });
    return '?';
  });
  return { text, slots };
}

const SQL_VERB = /^\s*(select|insert|update|delete|with)\b/i;
/** Statement safety (brief 4.4): allowed verbs only, and no multi-statements. */
export function assertSafeStatement(sql: string): void {
  if (!SQL_VERB.test(sql)) throw new Error('Statements must start with SELECT, INSERT, UPDATE, DELETE or WITH');
  const stripped = sql.replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, "''").trim().replace(/;\s*$/, '');
  if (stripped.includes(';')) throw new Error('Multiple statements are not allowed');
}

type Cmp = '=' | '!=' | '<' | '<=' | '>' | '>=';
type Operand = { k: 'p'; name: string } | { k: 'b'; bind: string; col: string } | { k: 'v'; v: Value };
function compileOperand(s: string): Operand {
  const b = s.match(/^\$([A-Za-z_]\w*)\.(\w+)$/); if (b) return { k: 'b', bind: b[1]!, col: b[2]! };
  const p = s.match(/^:([A-Za-z_]\w*)$/); if (p) return { k: 'p', name: p[1]! };
  if (s.trim() !== '' && Number.isFinite(Number(s))) return { k: 'v', v: Number(s) };
  return { k: 'v', v: s.replace(/^'(.*)'$/, '$1') };
}

export interface CompiledStep {
  raw: Step; sql: CompiledSql; bindAs?: string;
  guard?: { left: Operand; op: Cmp; right: Operand; leftText: string; rightText: string };
  expect?: { op: Cmp; value: number; onFail: 'reject' | 'retry' };
}
export function compileStep(s: Step): CompiledStep {
  assertSafeStatement(s.sql);
  return {
    raw: s, sql: compileSql(s.sql), bindAs: s.bindAs,
    guard: s.guard ? { left: compileOperand(s.guard.left), op: s.guard.op, right: compileOperand(s.guard.right), leftText: s.guard.left, rightText: s.guard.right } : undefined,
    expect: s.expectAffected ? { op: s.expectAffected.op, value: s.expectAffected.value, onFail: s.expectAffected.onFail } : undefined,
  };
}

export type Params = Record<string, Value>;
export type Binds = Record<string, Record<string, unknown> | null>;

export function compare(a: unknown, op: Cmp, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const na = Number(a); const nb = Number(b);
  const numeric = Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== '' && String(b).trim() !== '';
  const x = numeric ? na : String(a); const y = numeric ? nb : String(b);
  switch (op) {
    case '=': return x === y; case '!=': return x !== y;
    case '<': return x < y; case '<=': return x <= y; case '>': return x > y; case '>=': return x >= y;
  }
}

function resolve(o: Operand, params: Params, binds: Binds): unknown {
  if (o.k === 'v') return o.v;
  if (o.k === 'p') return params[o.name] ?? null;
  return binds[o.bind]?.[o.col] ?? null;
}

/** Business rejection: the transaction is rolled back and counted REJECTED (not ERROR). */
export class TxnReject extends Error {
  constructor(readonly reason: 'guard' | 'expect' | 'duplicate' | 'check', message: string) { super(message); this.name = 'TxnReject'; }
}
/** expectAffected{onFail:'retry'}: roll back and retry per the App retry policy (optimistic CAS failure). */
export class CasRetry extends Error {
  constructor(message = 'compare-and-set affected an unexpected number of rows') { super(message); this.name = 'CasRetry'; }
}

export interface Queryable { query(sql: string, values?: unknown[]): Promise<[unknown, unknown]> }
export interface StepInfo { index: number; sql: string; rows: unknown[]; rowCount: number; affected: number | null; ms: number; guard?: { passed: boolean; detail: string } }
export interface ExecHooks {
  /** Awaited before each statement (link round trip to the database). Not counted as DB time. */
  before?: (index: number) => Promise<void> | void;
  after?: (info: StepInfo) => void;
  onError?: (index: number, err: unknown, ms: number) => void;
}

const isRows = (r: unknown): r is unknown[] => Array.isArray(r);

/** Runs the steps on an open transaction. Throws TxnReject / CasRetry / the MySQL error. Returns the summed DB time and the last result rows. */
export async function execSteps(conn: Queryable, steps: CompiledStep[], params: Params, hooks?: ExecHooks): Promise<{ dbMs: number; lastRows: unknown[] }> {
  const binds: Binds = {};
  let dbMs = 0; let lastRows: unknown[] = [];
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]!;
    if (hooks?.before) await hooks.before(i);
    const values = st.sql.slots.length === 0 ? undefined : st.sql.slots.map((s) => (s.k === 'p' ? (params[s.name] ?? null) : (binds[s.bind]?.[s.col] ?? null)));
    const t0 = hr();
    let result: unknown;
    try {
      [result] = await conn.query(st.sql.text, values);
    } catch (err) {
      const ms = msSince(t0); dbMs += ms;
      hooks?.onError?.(i, err, ms);
      throw err;
    }
    const ms = msSince(t0); dbMs += ms;
    const rows = isRows(result) ? result : [];
    const affected = isRows(result) ? null : ((result as { affectedRows?: number }).affectedRows ?? 0);
    if (isRows(result)) lastRows = rows;
    if (st.bindAs) binds[st.bindAs] = (rows[0] as Record<string, unknown> | undefined) ?? null;
    const info: StepInfo = { index: i, sql: st.raw.sql, rows, rowCount: isRows(result) ? rows.length : (affected ?? 0), affected, ms };
    if (st.guard) {
      const l = resolve(st.guard.left, params, binds); const r = resolve(st.guard.right, params, binds);
      const passed = compare(l, st.guard.op, r);
      info.guard = { passed, detail: `${st.guard.leftText} (${String(l)}) ${st.guard.op} ${st.guard.rightText} (${String(r)})` };
    }
    let expectFail = false;
    if (st.expect) expectFail = !compare(affected ?? rows.length, st.expect.op, st.expect.value);
    hooks?.after?.(info);
    if (info.guard && !info.guard.passed) throw new TxnReject('guard', `guard failed: ${info.guard.detail}`);
    if (expectFail) {
      const msg = `expected affected ${st.expect!.op} ${st.expect!.value}, got ${affected ?? rows.length}`;
      if (st.expect!.onFail === 'retry') throw new CasRetry(msg);
      throw new TxnReject('expect', msg);
    }
  }
  return { dbMs, lastRows };
}
