// Pure comparison logic: metric deltas (direction-aware), run labels, findings/invariant matrices and the design diff.
import type { ColumnType, DesignDoc, Finding, Provenance, RunReport, Severity, Table } from '@datasim/shared';
import { formatMs, formatNumber, formatPct } from '../../lib/format';

// ---------------------------------------------------------------- metrics
export type Direction = 'higher' | 'lower' | 'neutral';
export interface MetricDef {
  key: string; label: string; direction: Direction; provenance: Provenance; unit: 'tps' | 'ms' | 'count' | 'ratio';
  get: (r: RunReport) => number | null;
}

const ratioOf = (n: number, d: number) => (d > 0 ? n / d : 0);
export const METRICS: MetricDef[] = [
  { key: 'tps', label: 'Throughput', direction: 'higher', provenance: 'MEASURED', unit: 'tps', get: (r) => r.run.tpsAvg },
  { key: 'p50', label: 'p50', direction: 'lower', provenance: 'MEASURED', unit: 'ms', get: (r) => r.run.p50Ms },
  { key: 'p95', label: 'p95', direction: 'lower', provenance: 'MEASURED', unit: 'ms', get: (r) => r.run.p95Ms },
  { key: 'p99', label: 'p99', direction: 'lower', provenance: 'MEASURED', unit: 'ms', get: (r) => r.run.p99Ms },
  { key: 'committed', label: 'Committed', direction: 'higher', provenance: 'MEASURED', unit: 'count', get: (r) => r.run.committed },
  { key: 'rejected', label: 'Rejected', direction: 'neutral', provenance: 'MEASURED', unit: 'count', get: (r) => r.run.rejected },
  { key: 'errors', label: 'Errors', direction: 'lower', provenance: 'MEASURED', unit: 'count', get: (r) => r.run.errored },
  { key: 'retries', label: 'Retries', direction: 'lower', provenance: 'MEASURED', unit: 'count', get: (r) => r.run.retries },
  { key: 'deadlocks', label: 'Deadlocks', direction: 'lower', provenance: 'MEASURED', unit: 'count', get: (r) => r.run.deadlocks },
  { key: 'violations', label: 'Invariant violations', direction: 'lower', provenance: 'MEASURED', unit: 'count', get: (r) => r.run.invariantViolations },
  { key: 'cache', label: 'Cache hit', direction: 'higher', provenance: 'MEASURED', unit: 'ratio', get: (r) => r.cacheHitRatio },
  { key: 'errorRate', label: 'Error rate', direction: 'lower', provenance: 'MEASURED', unit: 'ratio', get: (r) => ratioOf(r.run.errored, r.run.txnTotal) },
];

export function formatMetric(unit: MetricDef['unit'], v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '-';
  switch (unit) {
    case 'ms': return formatMs(v);
    case 'ratio': return formatPct(v, 1);
    case 'tps': case 'count': return formatNumber(v);
  }
}

export type Verdict = 'better' | 'worse' | 'same' | 'none';
export interface Delta { abs: number | null; pct: number | null; verdict: Verdict }

/** Relative changes below this are treated as noise (no green/red). */
export const SAME_EPS = 0.01;

/** Direction-aware delta of `v` against `base`: lower p95 is better, higher TPS is better, neutral metrics never get a colour. */
export function compareValue(base: number | null, v: number | null, direction: Direction): Delta {
  if (base == null || v == null || !Number.isFinite(base) || !Number.isFinite(v)) return { abs: null, pct: null, verdict: 'none' };
  const abs = v - base;
  const pct = base !== 0 ? abs / Math.abs(base) : null;
  const same = abs === 0 || (pct !== null && Math.abs(pct) < SAME_EPS);
  if (same) return { abs, pct, verdict: 'same' };
  if (direction === 'neutral') return { abs, pct, verdict: 'none' };
  const better = direction === 'higher' ? abs > 0 : abs < 0;
  return { abs, pct, verdict: better ? 'better' : 'worse' };
}

/** "+12.4%" when there is a non-zero baseline, otherwise the absolute change ("+93"); "=" for no change, "" when not comparable. */
export function formatDelta(d: Delta, unit: MetricDef['unit'] = 'count'): string {
  if (d.abs == null) return '';
  if (d.verdict === 'same' && d.abs === 0) return '=';
  const sign = d.abs > 0 ? '+' : '-';
  if (d.pct !== null) {
    const p = Math.abs(d.pct) * 100;
    return `${sign}${p >= 100 ? p.toFixed(0) : p.toFixed(1)}%`;
  }
  const a = Math.abs(d.abs);
  return `${sign}${unit === 'ms' ? formatMs(a) : unit === 'ratio' ? formatPct(a, 1) : formatNumber(a)}`;
}

// ---------------------------------------------------------------- labels
const LETTERS = 'ABCD';
export const runLetter = (i: number) => LETTERS[i] ?? String(i + 1);

/** "naive · rev 3"; runs that would collide get a short id suffix. Order is preserved. */
export function runLabels(runs: RunReport[]): string[] {
  const base = runs.map((r) => `${r.run.kind === 'CAPACITY' ? 'capacity · ' : ''}${r.run.strategy} · rev ${r.run.revisionNo}`);
  return base.map((b, i) => (base.filter((x) => x === b).length > 1 ? `${b} · ${runs[i]!.run.runId.slice(0, 4)}` : b));
}

// ---------------------------------------------------------------- findings + invariants matrices
/** Findings carry numbers in their titles ("(17)"), so identity is the kind plus the fix, or the title with digits blanked. */
export function findingKey(f: Finding): string {
  return f.fix ? `${f.kind}:${JSON.stringify(f.fix, Object.keys(f.fix).sort())}` : `${f.kind}:${f.title.replace(/[0-9][0-9.,]*/g, '#')}`;
}

export interface FindingRow { key: string; title: string; kind: string; cells: (Severity | null)[]; /** vs the first run */ status: ('same' | 'new' | 'resolved' | 'absent' | 'base')[]; differs: boolean }

export function diffFindings(runs: RunReport[]): FindingRow[] {
  const maps = runs.map((r) => new Map(r.findings.map((f) => [findingKey(f), f] as const)));
  const keys: string[] = [];
  for (const m of maps) for (const k of m.keys()) if (!keys.includes(k)) keys.push(k);
  const rows = keys.map((key): FindingRow => {
    const cells = maps.map((m) => m.get(key)?.severity ?? null);
    const first = maps.find((m) => m.has(key))!.get(key)!;
    const inBase = cells[0] !== null;
    const status = cells.map((c, i): FindingRow['status'][number] => (i === 0 ? (c ? 'base' : 'absent') : c && inBase ? 'same' : c ? 'new' : inBase ? 'resolved' : 'absent'));
    return { key, title: first.title, kind: first.kind, cells, status, differs: cells.some((c) => c === null) };
  });
  const rank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 };
  return rows.sort((a, b) => Number(b.differs) - Number(a.differs) || (rank[a.cells.find(Boolean) ?? 'INFO']! - rank[b.cells.find(Boolean) ?? 'INFO']!));
}

export interface InvariantRow { name: string; description: string; cells: ({ violations: number; passed: boolean; error?: string } | null)[] }
export function invariantMatrix(runs: RunReport[]): InvariantRow[] {
  const names: string[] = [];
  for (const r of runs) for (const i of r.invariants) if (!names.includes(i.name)) names.push(i.name);
  return names.map((name) => ({
    name,
    description: runs.flatMap((r) => r.invariants).find((i) => i.name === name)?.description ?? '',
    cells: runs.map((r) => { const i = r.invariants.find((x) => x.name === name); return i ? { violations: i.violations, passed: i.passed, ...(i.error ? { error: i.error } : {}) } : null; }),
  }));
}

// ---------------------------------------------------------------- chart data
/** One row per tS with a column per run (`r0`, `r1`, ...) for the overlay charts. */
export function overlaySeries(runs: RunReport[], pick: (s: RunReport['samples'][number]) => number): Record<string, number>[] {
  const byT = new Map<number, Record<string, number>>();
  runs.forEach((r, i) => {
    for (const s of r.samples) {
      const row = byT.get(s.tS) ?? { tS: s.tS };
      row[`r${i}`] = pick(s);
      byT.set(s.tS, row);
    }
  });
  return [...byT.values()].sort((a, b) => a.tS! - b.tS!);
}

// ---------------------------------------------------------------- design diff
export type DiffArea = 'Run settings' | 'Topology' | 'Schema' | 'Workload' | 'SLO';
export interface DiffEntry { area: DiffArea; kind: 'added' | 'removed' | 'changed'; label: string; before?: string; after?: string }

const show = (v: unknown): string => (v === undefined ? '-' : typeof v === 'string' ? v : JSON.stringify(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Field-by-field changes between two flat-ish objects. */
function fieldChanges(area: DiffArea, prefix: string, a: Record<string, unknown>, b: Record<string, unknown>): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!same(a[k], b[k])) out.push({ area, kind: 'changed', label: `${prefix}.${k}`, before: show(a[k]), after: show(b[k]) });
  }
  return out;
}

const typeSql = (t: ColumnType) => ('length' in t ? `${t.kind}(${t.length})` : t.kind === 'DECIMAL' ? `DECIMAL(${t.precision},${t.scale})` : t.kind === 'ENUM' ? `ENUM(${t.values.join(',')})` : t.kind);
const idxSig = (cols: string[], unique?: boolean) => `${unique ? 'UNIQUE ' : ''}(${cols.join(', ')})`;

function listDiff<T>(area: DiffArea, prefix: string, a: T[], b: T[], sig: (x: T) => string, describe: (x: T) => string = sig): DiffEntry[] {
  const as = new Map(a.map((x) => [sig(x), x])); const bs = new Map(b.map((x) => [sig(x), x]));
  return [
    ...[...bs].filter(([k]) => !as.has(k)).map(([, x]): DiffEntry => ({ area, kind: 'added', label: prefix, after: describe(x) })),
    ...[...as].filter(([k]) => !bs.has(k)).map(([, x]): DiffEntry => ({ area, kind: 'removed', label: prefix, before: describe(x) })),
  ];
}

function diffTable(a: Table, b: Table): DiffEntry[] {
  const out: DiffEntry[] = [];
  const t = `\`${a.name}\``;
  const ac = new Map(a.columns.map((c) => [c.name, c])); const bc = new Map(b.columns.map((c) => [c.name, c]));
  for (const [n, c] of bc) {
    const o = ac.get(n);
    if (!o) out.push({ area: 'Schema', kind: 'added', label: `${t} column`, after: `${n} ${typeSql(c.type)}${c.nullable ? '' : ' NOT NULL'}` });
    else {
      const sig = (x: typeof c) => ({ type: typeSql(x.type), nullable: x.nullable, default: x.default, autoIncrement: x.autoIncrement, generated: x.generated?.expr });
      out.push(...fieldChanges('Schema', `${t}.${n}`, sig(o), sig(c)));
    }
  }
  for (const [n, c] of ac) if (!bc.has(n)) out.push({ area: 'Schema', kind: 'removed', label: `${t} column`, before: `${n} ${typeSql(c.type)}` });
  if (!same(a.primaryKey, b.primaryKey)) out.push({ area: 'Schema', kind: 'changed', label: `${t} primary key`, before: a.primaryKey.join(', '), after: b.primaryKey.join(', ') });
  out.push(...listDiff('Schema', `${t} index`, a.indexes, b.indexes, (i) => idxSig(i.columns, i.unique), (i) => `${i.name} ${idxSig(i.columns, i.unique)}`));
  out.push(...listDiff('Schema', `${t} unique`, a.uniques, b.uniques, (u) => idxSig(u.columns)));
  out.push(...listDiff('Schema', `${t} foreign key`, a.foreignKeys, b.foreignKeys, (f) => `(${f.columns.join(', ')}) -> ${f.refTable}(${f.refColumns.join(', ')})`));
  out.push(...listDiff('Schema', `${t} check`, a.checks, b.checks, (c) => c.expr));
  if (a.seedRows !== b.seedRows) out.push({ area: 'Schema', kind: 'changed', label: `${t} seed rows`, before: formatNumber(a.seedRows), after: formatNumber(b.seedRows) });
  return out;
}

/** Everything that differs between two designs: topology, schema, workload, SLO. Empty when the documents are equivalent. */
export function diffDesigns(a: DesignDoc, b: DesignDoc): DiffEntry[] {
  const out: DiffEntry[] = [];
  // topology
  const an = new Map(a.nodes.map((n) => [n.id, n])); const bn = new Map(b.nodes.map((n) => [n.id, n]));
  for (const [id, n] of bn) {
    const o = an.get(id);
    if (!o) out.push({ area: 'Topology', kind: 'added', label: `node ${n.type}`, after: n.name });
    else {
      if (o.name !== n.name) out.push({ area: 'Topology', kind: 'changed', label: `${n.name} name`, before: o.name, after: n.name });
      out.push(...fieldChanges('Topology', n.name, o.config as Record<string, unknown>, n.config as Record<string, unknown>));
    }
  }
  for (const [id, n] of an) if (!bn.has(id)) out.push({ area: 'Topology', kind: 'removed', label: `node ${n.type}`, before: n.name });
  const ae = new Map(a.edges.map((e) => [`${e.source}>${e.target}`, e])); const be = new Map(b.edges.map((e) => [`${e.source}>${e.target}`, e]));
  const nodeName = (id: string) => bn.get(id)?.name ?? an.get(id)?.name ?? id;
  const edgeName = (k: string) => k.split('>').map(nodeName).join(' -> ');
  for (const [k, e] of be) {
    const o = ae.get(k);
    if (!o) out.push({ area: 'Topology', kind: 'added', label: 'link', after: edgeName(k) });
    else out.push(...fieldChanges('Topology', `link ${edgeName(k)}`, { latencyMs: o.latencyMs, jitterMs: o.jitterMs }, { latencyMs: e.latencyMs, jitterMs: e.jitterMs }));
  }
  for (const k of ae.keys()) if (!be.has(k)) out.push({ area: 'Topology', kind: 'removed', label: 'link', before: edgeName(k) });

  // schema
  const at = new Map(a.schema.tables.map((t) => [t.name, t])); const bt = new Map(b.schema.tables.map((t) => [t.name, t]));
  for (const [n, t] of bt) {
    const o = at.get(n);
    if (!o) out.push({ area: 'Schema', kind: 'added', label: 'table', after: `${n} (${t.columns.length} columns)` });
    else out.push(...diffTable(o, t));
  }
  for (const [n, t] of at) if (!bt.has(n)) out.push({ area: 'Schema', kind: 'removed', label: 'table', before: `${n} (${t.columns.length} columns)` });

  // workload
  const aw = new Map(a.workload.transactions.map((t) => [t.name, t])); const bw = new Map(b.workload.transactions.map((t) => [t.name, t]));
  for (const [n, t] of bw) {
    const o = aw.get(n);
    if (!o) { out.push({ area: 'Workload', kind: 'added', label: 'transaction', after: `${n} (weight ${t.weight})` }); continue; }
    out.push(...fieldChanges('Workload', n, { weight: o.weight, readOnly: o.readOnly, cacheable: o.cacheable, params: o.params }, { weight: t.weight, readOnly: t.readOnly, cacheable: t.cacheable, params: t.params }));
    for (const v of new Set([...Object.keys(o.variants), ...Object.keys(t.variants)])) {
      const x = (o.variants as Record<string, unknown>)[v]; const y = (t.variants as Record<string, unknown>)[v];
      if (x === undefined) out.push({ area: 'Workload', kind: 'added', label: `${n} variant`, after: v });
      else if (y === undefined) out.push({ area: 'Workload', kind: 'removed', label: `${n} variant`, before: v });
      else if (!same(x, y)) out.push({ area: 'Workload', kind: 'changed', label: `${n} variant ${v}`, before: `${(x as unknown[]).length} steps`, after: `${(y as unknown[]).length} steps (SQL edited)` });
    }
  }
  for (const [n] of aw) if (!bw.has(n)) out.push({ area: 'Workload', kind: 'removed', label: 'transaction', before: n });
  const ai = new Map(a.workload.invariants.map((i) => [i.name, i])); const bi = new Map(b.workload.invariants.map((i) => [i.name, i]));
  for (const [n, i] of bi) {
    const o = ai.get(n);
    if (!o) out.push({ area: 'Workload', kind: 'added', label: 'invariant', after: n });
    else if (o.sql !== i.sql) out.push({ area: 'Workload', kind: 'changed', label: `invariant ${n}`, before: 'SQL', after: 'SQL edited' });
  }
  for (const n of ai.keys()) if (!bi.has(n)) out.push({ area: 'Workload', kind: 'removed', label: 'invariant', before: n });

  // slo + capacity + seed
  out.push(...fieldChanges('SLO', 'slo', { p95Ms: a.slo.p95Ms, maxErrorPct: a.slo.maxErrorPct, perTxn: a.slo.perTxn }, { p95Ms: b.slo.p95Ms, maxErrorPct: b.slo.maxErrorPct, perTxn: b.slo.perTxn }));
  out.push(...fieldChanges('SLO', 'capacity', a.capacity as Record<string, unknown>, b.capacity as Record<string, unknown>));
  if (a.seed !== b.seed) out.push({ area: 'Workload', kind: 'changed', label: 'design seed', before: String(a.seed), after: String(b.seed) });
  return out;
}

/** Effective run settings (strategy / isolation / load) that differ between two runs, even when both ran the same revision. */
export function diffRunSettings(a: RunReport, b: RunReport): DiffEntry[] {
  const pick = (r: RunReport) => ({
    kind: r.run.kind, strategy: r.run.strategy, isolation: r.run.isolation, vus: r.run.vus, 'duration (s)': r.run.durationS, seed: r.run.seed,
    'row scale': r.settings.rowScale, 'load pattern': r.settings.pattern,
  });
  return fieldChanges('Run settings', 'run', pick(a), pick(b)).map((e) => ({ ...e, label: e.label.replace(/^run\./, '') }));
}

/** Full change list of run `b` relative to run `a`: run settings first, then the design (only when the revisions differ). */
export function diffRuns(a: RunReport, b: RunReport): DiffEntry[] {
  const design = a.run.revisionNo === b.run.revisionNo ? [] : diffDesigns(a.design, b.design);
  return [...diffRunSettings(a, b), ...design];
}
