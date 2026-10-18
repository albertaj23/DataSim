import type { ValueGenerator } from './schema';
import { Rng, zipfSampler } from './prng';

export type Value = string | number | boolean | null;
export type Row = Record<string, Value>;
/** Produces the value for row `i` (0-based). `row` holds the already-generated columns of the same row. */
export type GenFn = (i: number, row: Row) => Value;

export const FIRST_NAMES = ['Aarav', 'Aditi', 'Akash', 'Ananya', 'Arjun', 'Bhavna', 'Chetan', 'Deepa', 'Divya', 'Farhan', 'Gauri', 'Harsh', 'Isha', 'Jayant', 'Kavya', 'Kunal', 'Lakshmi', 'Manish', 'Meera', 'Naveen', 'Neha', 'Pooja', 'Pranav', 'Rahul', 'Riya', 'Rohan', 'Sanjay', 'Sneha', 'Tanvi', 'Varun', 'Vikram', 'Yash', 'Zoya', 'Karan', 'Nisha', 'Omkar', 'Priya', 'Sahil', 'Tara', 'Uday'];
export const LAST_NAMES = ['Agarwal', 'Bansal', 'Chopra', 'Desai', 'Gupta', 'Iyer', 'Jain', 'Kapoor', 'Kumar', 'Mehta', 'Nair', 'Patel', 'Rao', 'Reddy', 'Sharma', 'Singh', 'Verma', 'Yadav', 'Banerjee', 'Das', 'Menon', 'Pillai', 'Shetty', 'Thakur', 'Trivedi', 'Joshi', 'Kulkarni', 'Malhotra', 'Saxena', 'Sinha'];

const pad2 = (n: number) => String(n).padStart(2, '0');
function fmtDate(ms: number, withTime: boolean): string {
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return withTime ? `${date} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.${String(d.getUTCMilliseconds()).padStart(3, '0')}` : date;
}

/** Fill `#` (digit) and `@` (letter) placeholders. Sequential mode spreads the row index over the placeholders (unique while i < 10^digits). */
function fillPattern(pattern: string, i: number, rng: Rng, mode: 'sequential' | 'random'): string {
  const digitSlots = [...pattern].filter((c) => c === '#').length;
  const seq = String(i).padStart(digitSlots, '0').slice(-digitSlots || undefined);
  let d = 0;
  let letterIndex = i;
  return [...pattern].map((c) => {
    if (c === '#') return mode === 'sequential' ? (seq[d++] ?? '0') : String(rng.int(0, 9));
    if (c === '@') {
      const ch = mode === 'sequential' ? String.fromCharCode(65 + (letterIndex % 26)) : String.fromCharCode(65 + rng.int(0, 25));
      letterIndex = Math.floor(letterIndex / 26);
      return ch;
    }
    return c;
  }).join('');
}

export interface GenContext {
  rng: Rng;
  /** Parent keys for fkRef / fromTable (loaded before use). */
  keys?: ReadonlyArray<string | number>;
}

/** Builds a row-index-driven generator. Deterministic for a given ctx.rng seed. */
export function makeGenerator(gen: ValueGenerator, ctx: GenContext): GenFn {
  const { rng } = ctx;
  switch (gen.kind) {
    case 'sequence': return (i) => gen.start + i * gen.step;
    case 'uniformInt': return () => rng.int(gen.min, gen.max);
    case 'normalInt': return () => {
      const v = Math.round(gen.mean + gen.stddev * rng.gaussian());
      return Math.min(gen.max ?? Infinity, Math.max(gen.min ?? -Infinity, v));
    };
    case 'zipf': { const z = zipfSampler(gen.n, gen.s); return () => gen.min - 1 + z(rng); }
    case 'decimalRange': return () => Number((gen.min + rng.float() * (gen.max - gen.min)).toFixed(gen.scale));
    case 'pickList': return () => (gen.weights ? rng.weighted(gen.values, gen.weights) : rng.pick(gen.values));
    case 'personName': return () => `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    case 'email': return (i, row) => {
      const base = gen.from && typeof row[gen.from] === 'string' ? String(row[gen.from]).toLowerCase().replace(/[^a-z0-9]+/g, '.') : 'user';
      return `${base}.${i + 1}@${gen.domain}`;
    };
    case 'pattern': return (i) => fillPattern(gen.pattern, i, rng, gen.mode);
    case 'dateRange': {
      const from = Date.parse(gen.from); const to = Date.parse(gen.to);
      const withTime = gen.from.length > 10 || gen.to.length > 10;
      return () => fmtDate(from + rng.float() * (to - from), withTime);
    }
    case 'constant': return () => gen.value;
    case 'fkRef':
    case 'fromTable': {
      const keys = ctx.keys ?? [];
      if (keys.length === 0) return () => null;
      if (gen.dist === 'zipf') { const z = zipfSampler(keys.length, gen.s); return () => keys[z(rng) - 1]!; }
      return () => keys[Math.floor(rng.float() * keys.length)]!;
    }
    case 'expression': return (_i, row) => evalExpression(gen.expr, row);
  }
}

/** Preview values for UI (5-value sample). Generators that need other tables/rows return a descriptive placeholder. */
export function previewGenerator(gen: ValueGenerator, n = 5, seed = 1): Value[] {
  if (gen.kind === 'fkRef' || gen.kind === 'fromTable') return Array.from({ length: n }, () => `<${gen.table}.${gen.column}>`);
  if (gen.kind === 'expression') return Array.from({ length: n }, () => `= ${gen.expr}`);
  const fn = makeGenerator(gen, { rng: new Rng(seed) });
  return Array.from({ length: n }, (_, i) => fn(i, {}));
}

// ---------------------------------------------------------------- tiny expression evaluator (no eval)
type Tok = { t: 'num' | 'str' | 'id' | 'op'; v: string };
function tokenize(src: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) { let j = i; while (j < src.length && /[0-9.]/.test(src[j]!)) j++; out.push({ t: 'num', v: src.slice(i, j) }); i = j; continue; }
    if (c === "'") { let j = i + 1; while (j < src.length && src[j] !== "'") j++; out.push({ t: 'str', v: src.slice(i + 1, j) }); i = j + 1; continue; }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++; out.push({ t: 'id', v: src.slice(i, j) }); i = j; continue; }
    if ('+-*/(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`unexpected character "${c}" in expression`);
  }
  return out;
}
const FNS: Record<string, (...a: Value[]) => Value> = {
  upper: (a) => String(a).toUpperCase(), lower: (a) => String(a).toLowerCase(),
  concat: (...a) => a.map((x) => String(x ?? '')).join(''),
  round: (a, d = 0) => Number(Number(a).toFixed(Number(d))), floor: (a) => Math.floor(Number(a)), abs: (a) => Math.abs(Number(a)),
};
export function evalExpression(expr: string, row: Row): Value {
  const toks = tokenize(expr); let p = 0;
  const peek = () => toks[p]; const eat = () => toks[p++]!;
  const add = (a: Value, b: Value): Value => (typeof a === 'number' && typeof b === 'number' ? a + b : `${a ?? ''}${b ?? ''}`);
  function primary(): Value {
    const t = eat();
    if (t.t === 'num') return Number(t.v);
    if (t.t === 'str') return t.v;
    if (t.t === 'op' && t.v === '(') { const v = sum(); eat(); return v; }
    if (t.t === 'op' && t.v === '-') return -Number(primary());
    if (t.t === 'id') {
      if (peek()?.v === '(') {
        eat(); const args: Value[] = [];
        while (peek() && peek()!.v !== ')') { args.push(sum()); if (peek()?.v === ',') eat(); }
        eat();
        const fn = FNS[t.v.toLowerCase()]; if (!fn) throw new Error(`unknown function ${t.v}`);
        return fn(...args);
      }
      if (!(t.v in row)) throw new Error(`unknown column ${t.v}`);
      return row[t.v] ?? null;
    }
    throw new Error('bad expression');
  }
  function product(): Value {
    let v = primary();
    while (peek()?.v === '*' || peek()?.v === '/') { const op = eat().v; const r = Number(primary()); v = op === '*' ? Number(v) * r : Number(v) / r; }
    return v;
  }
  function sum(): Value {
    let v = product();
    while (peek()?.v === '+' || peek()?.v === '-') { const op = eat().v; const r = product(); v = op === '+' ? add(v, r) : Number(v) - Number(r); }
    return v;
  }
  const result = sum();
  if (p < toks.length) throw new Error('unexpected trailing tokens in expression');
  return result;
}
