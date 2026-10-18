// Pure workload-editing logic (no React): weights, factories, variants, placeholder scanning, SQL completion and EXPLAIN inlining.
import { previewGenerator, STRATEGY_VARIANTS, type DesignDoc, type QueryResponse, type SchemaModel, type Step, type TestTxnResponse, type Transaction } from '@datasim/shared';
import { uniqueName } from '../schema/logic';

export type Variant = (typeof STRATEGY_VARIANTS)[number];

// ---------------------------------------------------------------- weights
/** Percent share of each transaction (0..100). All zero when the total weight is zero. */
export function mixPercents(txns: ReadonlyArray<Pick<Transaction, 'weight'>>): number[] {
  const total = txns.reduce((n, t) => n + t.weight, 0);
  return txns.map((t) => (total > 0 ? (t.weight / total) * 100 : 0));
}

/** Rewrites weights as whole percents summing to exactly 100 (largest-remainder rounding). No-op when every weight is 0. */
export function normalizeWeights(txns: Array<Pick<Transaction, 'weight'>>): void {
  const raw = mixPercents(txns);
  if (raw.every((p) => p === 0)) return;
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((p, i) => ({ i, frac: p - Math.floor(p) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) { if (left <= 0) break; floors[i]!++; left--; }
  txns.forEach((t, i) => { t.weight = floors[i]!; });
}

export const formatPct = (p: number) => (p === 0 ? '0%' : p < 1 ? '<1%' : p >= 10 || Math.abs(p - Math.round(p)) < 0.05 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`);

// ---------------------------------------------------------------- factories
export const newStep = (): Step => ({ sql: 'SELECT 1' });

export function newTransaction(design: DesignDoc): Transaction {
  return {
    name: uniqueName('new_txn', design.workload.transactions.map((t) => t.name)),
    weight: 10, readOnly: false, cacheable: false, description: '', params: {}, variants: { default: [newStep()] },
  };
}

export function duplicateTransaction(t: Transaction, taken: string[]): Transaction {
  const copy = structuredClone(t);
  copy.name = uniqueName(`${t.name}_copy`.slice(0, 64), taken);
  return copy;
}

/** Renames a transaction and the per-transaction SLO target keyed by its name. */
export function renameTransaction(design: DesignDoc, from: string, to: string): void {
  const t = design.workload.transactions.find((x) => x.name === from);
  if (!t) return;
  t.name = to;
  if (from in design.slo.perTxn) { design.slo.perTxn[to] = design.slo.perTxn[from]!; delete design.slo.perTxn[from]; }
}

/** Removes a transaction and its per-transaction SLO target. */
export function deleteTransaction(design: DesignDoc, name: string): void {
  design.workload.transactions = design.workload.transactions.filter((t) => t.name !== name);
  delete design.slo.perTxn[name];
}

/** Variants in canonical order (default first). */
export const variantsOf = (t: Transaction): Variant[] => STRATEGY_VARIANTS.filter((v) => v in t.variants);
export const missingVariants = (t: Transaction): Variant[] => STRATEGY_VARIANTS.filter((v) => !(v in t.variants));

/** Adds a variant seeded with a copy of `default`, so it can be edited into the strategy. */
export function addVariant(t: Transaction, v: Variant): void {
  if (v in t.variants) return;
  t.variants[v] = structuredClone(t.variants.default ?? [newStep()]);
}

/** `default` cannot be removed. */
export function removeVariant(t: Transaction, v: Variant): boolean {
  if (v === 'default' || !(v in t.variants)) return false;
  delete t.variants[v];
  return true;
}

export function moveItem<T>(list: T[], from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
  const [x] = list.splice(from, 1);
  list.splice(to, 0, x!);
}

// ---------------------------------------------------------------- placeholders
export const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface PlaceholderHit { kind: 'param' | 'bind'; name: string; col?: string; from: number; to: number }

/** Same scan as the shared `extractPlaceholders` (string literals and backticks skipped) but with offsets. */
export function scanPlaceholders(sql: string): PlaceholderHit[] {
  const out: PlaceholderHit[] = [];
  const re = /'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"|`[^`]*`|(?<!:):(?:\$([A-Za-z_]\w*)\.(\w+)|([A-Za-z_]\w*))/g;
  for (const m of sql.matchAll(re)) {
    if (m[0]![0] !== ':') continue;
    const from = m.index!;
    if (m[1]) out.push({ kind: 'bind', name: m[1], col: m[2], from, to: from + m[0].length });
    else out.push({ kind: 'param', name: m[3]!, from, to: from + m[0].length });
  }
  return out;
}

export interface BindScope { name: string; columns: string[] }
/** What a step may reference: the transaction's params and the binds saved by earlier steps. */
export interface PlaceholderScope { params: string[]; binds: BindScope[] }

export interface Diagnostic { kind: 'param' | 'bind'; name: string; from: number; to: number; message: string }

export function placeholderDiagnostics(sql: string, scope: PlaceholderScope): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const h of scanPlaceholders(sql)) {
    if (h.kind === 'param' && !scope.params.includes(h.name)) out.push({ kind: 'param', name: h.name, from: h.from, to: h.to, message: `Unknown parameter :${h.name}` });
    if (h.kind === 'bind') {
      const b = scope.binds.find((x) => x.name === h.name);
      if (!b) out.push({ kind: 'bind', name: h.name, from: h.from, to: h.to, message: `$${h.name} is not bound by an earlier step` });
      else if (b.columns.length > 0 && h.col && !b.columns.includes(h.col)) out.push({ kind: 'bind', name: h.name, from: h.from, to: h.to, message: `$${h.name} has no column ${h.col}` });
    }
  }
  return out;
}

/** Rewrites `:old` to `:new` in every statement of the transaction (variants and guards). */
export function renameParam(t: Transaction, from: string, to: string): void {
  const rewrite = (sql: string) => {
    let out = ''; let last = 0;
    for (const h of scanPlaceholders(sql)) {
      if (h.kind !== 'param' || h.name !== from) continue;
      out += sql.slice(last, h.from) + `:${to}`; last = h.to;
    }
    return out + sql.slice(last);
  };
  for (const steps of Object.values(t.variants)) {
    for (const s of steps) {
      s.sql = rewrite(s.sql);
      if (s.guard) { s.guard.left = s.guard.left === `:${from}` ? `:${to}` : s.guard.left; s.guard.right = s.guard.right === `:${from}` ? `:${to}` : s.guard.right; }
    }
  }
  if (from in t.params) {
    t.params = Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k === from ? to : k, v]));
  }
}

// ---------------------------------------------------------------- SQL schema / columns of a statement
/** `{ table: [columns] }` for @codemirror/lang-sql. */
export function completionSchema(schema: SchemaModel): Record<string, string[]> {
  return Object.fromEntries(schema.tables.map((t) => [t.name, t.columns.map((c) => c.name)]));
}

const maskLiterals = (sql: string) => sql.replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"/g, (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[0]);

/** Tables named after FROM / JOIN / UPDATE / INTO (aliases ignored). */
export function tablesIn(sql: string): string[] {
  const out: string[] = [];
  for (const m of maskLiterals(sql).matchAll(/\b(?:from|join|update|into)\s+`?([A-Za-z_]\w*)`?/gi)) out.push(m[1]!);
  return [...new Set(out)];
}

/** Output column names of a top-level SELECT list (aliases, else the last identifier). `*` expands to the columns of the statement's tables. */
export function selectColumns(sql: string, schema: Record<string, string[]>): string[] {
  const s = maskLiterals(sql);
  const m = s.match(/^\s*select\s+(?:distinct\s+)?([\s\S]*?)\s+from\b/i);
  if (!m) return [];
  const list: string[] = []; let depth = 0; let cur = '';
  for (const ch of m[1]!) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { list.push(cur); cur = ''; } else cur += ch;
  }
  list.push(cur);
  const cols: string[] = [];
  for (const raw of list) {
    const item = raw.trim();
    if (!item) continue;
    if (item === '*' || item.endsWith('.*')) { for (const t of tablesIn(sql)) cols.push(...(schema[t] ?? [])); continue; }
    const alias = item.match(/\bas\s+`?([A-Za-z_]\w*)`?\s*$/i)?.[1] ?? (/^[\w.`]+$/.test(item) ? item.replace(/`/g, '').split('.').pop() : item.match(/\s`?([A-Za-z_]\w*)`?$/)?.[1]);
    if (alias) cols.push(alias);
  }
  return [...new Set(cols)];
}

/** Scope for step `index` of a variant: all params plus the binds of earlier steps with their column names. */
export function scopeForStep(t: Transaction, steps: Step[], index: number, schema: SchemaModel): PlaceholderScope {
  const cs = completionSchema(schema);
  const binds: BindScope[] = [];
  steps.slice(0, index).forEach((s) => { if (s.bindAs) binds.push({ name: s.bindAs, columns: selectColumns(s.sql, cs) }); });
  return { params: Object.keys(t.params), binds };
}

// ---------------------------------------------------------------- autocomplete for :params and :$binds
export interface PlaceholderCompletion { from: number; options: Array<{ label: string; detail: string }> }

/** Completions for the text before the cursor, or null when the cursor is not in a placeholder. `from` is an offset into `before`. */
export function placeholderCompletion(before: string, scope: PlaceholderScope): PlaceholderCompletion | null {
  const col = before.match(/(?<!:):\$([A-Za-z_]\w*)\.(\w*)$/);
  if (col) {
    const b = scope.binds.find((x) => x.name === col[1]);
    if (!b) return null;
    return { from: before.length - col[2]!.length, options: b.columns.map((c) => ({ label: c, detail: `column of $${b.name}` })) };
  }
  const bind = before.match(/(?<!:):(\$\w*)$/);
  if (bind) return { from: before.length - bind[1]!.length, options: scope.binds.map((b) => ({ label: `$${b.name}`, detail: 'bound by an earlier step' })) };
  const param = before.match(/(?<![:\w]):(\w*)$/);
  if (param) return { from: before.length - param[1]!.length, options: scope.params.map((p) => ({ label: p, detail: 'parameter' })) };
  return null;
}

// ---------------------------------------------------------------- EXPLAIN: inline sample values
const sqlLiteral = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
};

/** Replaces `:param` / `:$bind.col` with literal values (unknown ones become NULL). */
export function inlinePlaceholders(sql: string, params: Record<string, unknown>, binds: Record<string, Record<string, unknown> | null | undefined>): string {
  let out = ''; let last = 0;
  for (const h of scanPlaceholders(sql)) {
    const v = h.kind === 'param' ? params[h.name] : binds[h.name]?.[h.col!];
    out += sql.slice(last, h.from) + sqlLiteral(v); last = h.to;
  }
  return out + sql.slice(last);
}

/** One sample value per param. Key-sampling params (`fromTable`) have no value without the sandbox rows: 1 is used. */
export function sampleParams(t: Transaction, seed: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, g] of Object.entries(t.params)) {
    if (g.kind === 'fromTable') { out[name] = 1; continue; }
    try { out[name] = previewGenerator(g, 1, seed)[0] ?? null; } catch { out[name] = null; }
  }
  return out;
}

/** First result row of every step that has `bindAs`, from a Test once response. */
export function bindsFromTest(steps: Step[], res: TestTxnResponse): Record<string, Record<string, unknown> | null> {
  const out: Record<string, Record<string, unknown> | null> = {};
  steps.forEach((s, i) => {
    if (!s.bindAs) return;
    const row = res.steps.find((r) => r.index === i)?.rows[0];
    out[s.bindAs] = row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : null;
  });
  return out;
}

/** The sandbox accepts EXPLAIN for SELECT / WITH only (not DML). */
export const isExplainable = (sql: string) => /^\s*(select|with)\b/i.test(sql);

// ---------------------------------------------------------------- invariants
/** The `violations` number of a one-row result (falls back to the first column). */
export function violationsOf(r: QueryResponse): number | null {
  const row = r.rows[0];
  if (!row) return null;
  const i = r.columns.findIndex((c) => c.toLowerCase() === 'violations');
  const v = Number(row[i >= 0 ? i : 0]);
  return Number.isFinite(v) ? v : null;
}
