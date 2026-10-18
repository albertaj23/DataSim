// Normalization assistant: pure functions (no I/O) so the server route and the web UI can share and unit-test them.
// Attribute sets are bit masks internally (max MAX_ATTRS attributes); the public API uses attribute names.

export interface FD { lhs: string[]; rhs: string[] }
export type NormalForm = '1NF' | '2NF' | '3NF' | 'BCNF';
export const MAX_ATTRS = 16;

export interface FdViolation {
  fd: FD;
  /** Every normal form this FD breaks (BCNF is implied by 3NF and 2NF violations). */
  violates: Array<'2NF' | '3NF' | 'BCNF'>;
  reason: string;
}
export interface Fragment { attributes: string[]; keys: string[][]; fds: FD[] }
export interface Decomposition {
  relations: Fragment[];
  losslessJoin: boolean;
  preservesDependencies: boolean;
  steps: string[];
}
export interface NormalizeResult {
  attributes: string[];
  candidateKeys: string[][];
  primeAttributes: string[];
  nonPrimeAttributes: string[];
  minimalCover: FD[];
  highestNormalForm: NormalForm;
  violations: FdViolation[];
  bcnf: Decomposition;
  threeNf: Decomposition;
  /** Present when `closureOf` was requested. */
  closure?: string[];
}

class Ctx {
  readonly index = new Map<string, number>();
  constructor(readonly attrs: string[]) {
    if (attrs.length === 0) throw new Error('at least one attribute is required');
    if (attrs.length > MAX_ATTRS) throw new Error(`at most ${MAX_ATTRS} attributes are supported`);
    attrs.forEach((a, i) => { if (this.index.has(a)) throw new Error(`duplicate attribute ${a}`); this.index.set(a, i); });
  }
  get all() { return (1 << this.attrs.length) - 1; }
  mask(names: string[]): number {
    return names.reduce((m, n) => {
      const i = this.index.get(n);
      if (i === undefined) throw new Error(`unknown attribute ${n}`);
      return m | (1 << i);
    }, 0);
  }
  names(mask: number): string[] { return this.attrs.filter((_, i) => mask & (1 << i)); }
}
interface MFD { l: number; r: number }

const popcount = (m: number) => { let c = 0; for (let x = m; x; x &= x - 1) c++; return c; };
const subset = (a: number, b: number) => (a & ~b) === 0;
const submasks = (m: number): number[] => { const out: number[] = []; for (let s = m; s > 0; s = (s - 1) & m) out.push(s); return out.sort((a, b) => popcount(a) - popcount(b) || a - b); };

function closureM(x: number, fds: MFD[]): number {
  let c = x; let changed = true;
  while (changed) {
    changed = false;
    for (const f of fds) if (subset(f.l, c) && (f.r & ~c)) { c |= f.r; changed = true; }
  }
  return c;
}

function toM(ctx: Ctx, fds: FD[]): MFD[] { return fds.map((f) => ({ l: ctx.mask(f.lhs), r: ctx.mask(f.rhs) })); }
const fromM = (ctx: Ctx, fds: MFD[]): FD[] => fds.map((f) => ({ lhs: ctx.names(f.l), rhs: ctx.names(f.r) }));

/** X+ : the attributes functionally determined by `attrs`. */
export function attributeClosure(attributes: string[], fds: FD[], attrs: string[]): string[] {
  const ctx = new Ctx(attributes);
  return ctx.names(closureM(ctx.mask(attrs), toM(ctx, fds)));
}

function keysM(ctx: Ctx, fds: MFD[], within = ctx.all): number[] {
  const rhsUnion = fds.reduce((m, f) => m | (f.r & ~f.l), 0);
  const lhsUnion = fds.reduce((m, f) => m | f.l, 0);
  const core = within & ~rhsUnion;
  if (subset(within, closureM(core, fds))) return [core];
  const mid = within & ~core & lhsUnion & rhsUnion;
  const keys: number[] = [];
  for (const s of [0, ...submasks(mid)]) {
    const k = core | s;
    if (keys.some((x) => subset(x, k))) continue;
    if (subset(within, closureM(k, fds))) keys.push(k);
  }
  return keys;
}

/** Minimal candidate keys. */
export function candidateKeys(attributes: string[], fds: FD[]): string[][] {
  const ctx = new Ctx(attributes);
  return keysM(ctx, toM(ctx, fds)).map((k) => ctx.names(k));
}

function minimalCoverM(fds: MFD[]): MFD[] {
  // 1. singleton right-hand sides, drop trivial parts
  let f: MFD[] = [];
  for (const d of fds) for (let b = 1; b <= d.r; b <<= 1) if ((d.r & b) && !(d.l & b)) f.push({ l: d.l, r: b });
  // 2. remove extraneous left-hand attributes
  f = f.map((d) => {
    let l = d.l;
    for (let b = 1; b <= d.l; b <<= 1) if ((l & b) && popcount(l) > 1 && subset(d.r, closureM(l & ~b, f))) l &= ~b;
    return { l, r: d.r };
  });
  // 3. dedupe, then remove redundant FDs
  f = f.filter((d, i) => f.findIndex((e) => e.l === d.l && e.r === d.r) === i);
  for (let i = 0; i < f.length;) {
    const rest = f.filter((_, j) => j !== i);
    if (subset(f[i]!.r, closureM(f[i]!.l, rest))) f = rest; else i++;
  }
  return f;
}
const mergeByLhs = (fds: MFD[]): MFD[] => {
  const m = new Map<number, number>();
  for (const f of fds) m.set(f.l, (m.get(f.l) ?? 0) | f.r);
  return [...m].map(([l, r]) => ({ l, r }));
};

/** Canonical (minimal) cover, with right-hand sides of equal left-hand side merged. */
export function minimalCover(attributes: string[], fds: FD[]): FD[] {
  const ctx = new Ctx(attributes);
  return fromM(ctx, mergeByLhs(minimalCoverM(toM(ctx, fds))));
}

/** FDs that hold on a fragment: closures of its attribute subsets, restricted to the fragment. */
function projectM(frag: number, fds: MFD[]): MFD[] {
  const out: MFD[] = [];
  for (const x of submasks(frag)) {
    const r = closureM(x, fds) & frag & ~x;
    if (r) out.push({ l: x, r });
  }
  return minimalCoverM(out);
}

/** Tableau chase: true if the natural join of the fragments reproduces the relation. */
export function isLosslessJoin(attributes: string[], fds: FD[], fragments: string[][]): boolean {
  const ctx = new Ctx(attributes); const f = toM(ctx, fds); const n = ctx.attrs.length;
  const frags = fragments.map((x) => ctx.mask(x));
  const t = frags.map((fr, i) => Array.from({ length: n }, (_, c) => (fr & (1 << c) ? 0 : (i + 1) * 100 + c)));
  const unify = (a: number, b: number) => { const keep = Math.min(a, b); const drop = Math.max(a, b); for (const row of t) for (let c = 0; c < n; c++) if (row[c] === drop) row[c] = keep; };
  for (let changed = true; changed;) {
    changed = false;
    for (const d of f) {
      const lc = ctx.names(d.l).map((a) => ctx.index.get(a)!);
      const rc = ctx.names(d.r).map((a) => ctx.index.get(a)!);
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
        if (!lc.every((c) => t[i]![c] === t[j]![c])) continue;
        for (const c of rc) if (t[i]![c] !== t[j]![c]) { unify(t[i]![c]!, t[j]![c]!); changed = true; }
      }
    }
  }
  return t.some((row) => row.every((v) => v === 0));
}

/** True if every FD of F follows from the FDs projected on the fragments (without computing the projections). */
export function preservesDependencies(attributes: string[], fds: FD[], fragments: string[][]): boolean {
  const ctx = new Ctx(attributes); const f = toM(ctx, fds); const frags = fragments.map((x) => ctx.mask(x));
  return f.every((d) => {
    let z = d.l;
    for (let changed = true; changed;) {
      changed = false;
      for (const r of frags) { const nz = z | (closureM(z & r, f) & r); if (nz !== z) { z = nz; changed = true; } }
    }
    return subset(d.r, z);
  });
}

interface NfAnalysis { nf: NormalForm; violations: FdViolation[]; keys: number[]; prime: number }
function analyze(ctx: Ctx, fds: MFD[]): NfAnalysis {
  const keys = keysM(ctx, fds);
  const prime = keys.reduce((m, k) => m | k, 0);
  const violations: FdViolation[] = [];
  const isSuper = (x: number) => subset(ctx.all, closureM(x, fds));
  for (const d of fds) {
    const nontrivial = d.r & ~d.l;
    if (!nontrivial) continue;
    const fd: FD = { lhs: ctx.names(d.l), rhs: ctx.names(nontrivial) };
    const violates: FdViolation['violates'] = [];
    const reasons: string[] = [];
    const partial = (nontrivial & ~prime) && keys.some((k) => subset(d.l, k) && d.l !== k);
    if (partial) { violates.push('2NF'); reasons.push(`${fd.lhs.join(', ')} is only part of a candidate key but determines non-prime ${ctx.names(nontrivial & ~prime).join(', ')} (partial dependency)`); }
    if (!isSuper(d.l)) {
      if (nontrivial & ~prime) { violates.push('3NF'); if (!partial) reasons.push(`${fd.lhs.join(', ')} is not a superkey and determines non-prime ${ctx.names(nontrivial & ~prime).join(', ')} (transitive dependency)`); }
      violates.push('BCNF');
      if (!(nontrivial & ~prime)) reasons.push(`${fd.lhs.join(', ')} is not a superkey (it determines only prime attributes, so the relation is still in 3NF)`);
    }
    if (violates.length) violations.push({ fd, violates, reason: reasons.join('; ') });
  }
  const nf: NormalForm = !violations.length ? 'BCNF' : !violations.some((v) => v.violates.includes('3NF')) ? '3NF' : !violations.some((v) => v.violates.includes('2NF')) ? '2NF' : '1NF';
  return { nf, violations, keys, prime };
}

function toFragment(ctx: Ctx, frag: number, fds: MFD[]): Fragment {
  const projected = projectM(frag, fds);
  return { attributes: ctx.names(frag), keys: keysM(ctx, projected, frag).map((k) => ctx.names(k)), fds: fromM(ctx, mergeByLhs(projected)) };
}
const dropContained = (frags: number[]): number[] => frags.filter((f, i) => !frags.some((g, j) => j !== i && subset(f, g) && (f !== g || j < i)));

function bcnfDecompose(ctx: Ctx, fds: MFD[]): Decomposition {
  let frags = [ctx.all]; const steps: string[] = [];
  for (;;) {
    let split: { r: number; x: number; c: number } | null = null;
    for (const r of frags) {
      const cand = [...fds.map((d) => d.l).filter((l) => subset(l, r)), ...submasks(r)];
      for (const x of cand) {
        const c = closureM(x, fds) & r;
        if (c !== x && c !== r) { split = { r, x, c }; break; }
      }
      if (split) break;
    }
    if (!split) break;
    const { r, x, c } = split;
    const r1 = c; const r2 = (r & ~c) | x;
    steps.push(`Split (${ctx.names(r).join(', ')}) on ${ctx.names(x).join(', ')} -> ${ctx.names(c & ~x).join(', ')}: (${ctx.names(r1).join(', ')}) and (${ctx.names(r2).join(', ')})`);
    frags = frags.flatMap((f) => (f === r ? [r1, r2] : [f]));
  }
  frags = dropContained(frags);
  if (steps.length === 0) steps.push('Already in BCNF: no decomposition needed');
  const names = frags.map((f) => ctx.names(f));
  return {
    relations: frags.map((f) => toFragment(ctx, f, fds)), steps,
    losslessJoin: isLosslessJoin(ctx.attrs, fromM(ctx, fds), names),
    preservesDependencies: preservesDependencies(ctx.attrs, fromM(ctx, fds), names),
  };
}

function synthesize3nf(ctx: Ctx, fds: MFD[]): Decomposition {
  const cover = mergeByLhs(minimalCoverM(fds));
  const steps = [`Minimal cover: ${cover.map((d) => `${ctx.names(d.l).join(', ')} -> ${ctx.names(d.r).join(', ')}`).join('; ') || '(none)'}`];
  let frags = dropContained(cover.map((d) => d.l | d.r));
  const keys = keysM(ctx, fds);
  if (!frags.some((f) => keys.some((k) => subset(k, f)))) {
    frags.push(keys[0]!);
    steps.push(`No relation contains a candidate key: added (${ctx.names(keys[0]!).join(', ')}) to keep the join lossless`);
  }
  frags = dropContained(frags);
  frags.forEach((f) => steps.push(`Relation (${ctx.names(f).join(', ')})`));
  const names = frags.map((f) => ctx.names(f));
  return {
    relations: frags.map((f) => toFragment(ctx, f, fds)), steps,
    losslessJoin: isLosslessJoin(ctx.attrs, fromM(ctx, fds), names),
    preservesDependencies: preservesDependencies(ctx.attrs, fromM(ctx, fds), names),
  };
}

/** Parses "A, B -> C, D" lines (also accepts the unicode arrow). Throws on malformed lines. */
export function parseFds(text: string): FD[] {
  return text.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const [l, r, ...rest] = line.split(/->|→/);
    if (r === undefined || rest.length) throw new Error(`Cannot parse "${line}": expected "A, B -> C"`);
    const side = (s: string) => s.split(/[\s,]+/).filter(Boolean);
    const fd = { lhs: side(l!), rhs: side(r) };
    if (!fd.lhs.length || !fd.rhs.length) throw new Error(`Cannot parse "${line}": both sides need attributes`);
    return fd;
  });
}

/** Full analysis: keys, prime attributes, highest normal form with violating FDs, BCNF decomposition, 3NF synthesis. */
export function normalize(attributes: string[], fds: FD[], closureOf?: string[]): NormalizeResult {
  const ctx = new Ctx(attributes); const f = toM(ctx, fds);
  const a = analyze(ctx, f);
  return {
    attributes,
    candidateKeys: a.keys.map((k) => ctx.names(k)),
    primeAttributes: ctx.names(a.prime),
    nonPrimeAttributes: ctx.names(ctx.all & ~a.prime),
    minimalCover: fromM(ctx, mergeByLhs(minimalCoverM(f))),
    highestNormalForm: a.nf,
    violations: a.violations,
    bcnf: bcnfDecompose(ctx, f),
    threeNf: synthesize3nf(ctx, f),
    ...(closureOf ? { closure: ctx.names(closureM(ctx.mask(closureOf), f)) } : {}),
  };
}
