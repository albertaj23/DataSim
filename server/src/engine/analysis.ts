// Post-run analysis: invariants, statement digests, EXPLAIN, advisor findings v1, bottleneck detection, SLO verdict.
import mysql, { type Connection } from 'mysql2/promise';
import { MAX_TOTAL_POOL, strategyFor } from '@datasim/shared';
import type {
  Bottleneck, DesignDoc, Finding, FindingFix, FindingKind, InvariantResult, Severity, SloVerdict, StatementStat, StrategyVariant, Table,
} from '@datasim/shared';
import { compileSql } from './exec.js';
import type { LoadResult } from './load.js';
import { round } from './util.js';

// ---------------------------------------------------------------- invariants
export async function checkInvariants(conn: Connection, design: DesignDoc): Promise<InvariantResult[]> {
  const out: InvariantResult[] = [];
  await conn.query('SET SESSION max_execution_time = 20000').catch(() => undefined);
  for (const inv of design.workload.invariants) {
    try {
      const [rows] = await conn.query(inv.sql);
      const first = (rows as Array<Record<string, unknown>>)[0];
      const raw = first ? (first.violations ?? Object.values(first)[0]) : 0;
      const n = Number(raw ?? 0);
      if (!Number.isFinite(n)) throw new Error(`invariant returned a non-numeric value: ${String(raw)}`);
      out.push({ name: inv.name, description: inv.description, sql: inv.sql, violations: Math.max(0, Math.round(n)), passed: n === 0 });
    } catch (err) {
      out.push({ name: inv.name, description: inv.description, sql: inv.sql, violations: 0, passed: false, error: (err as { sqlMessage?: string }).sqlMessage ?? (err as Error).message });
    }
  }
  return out;
}

// ---------------------------------------------------------------- statement digests
export type DigestRow = { DIGEST: string; DIGEST_TEXT: string; COUNT_STAR: string | number; SUM_TIMER_WAIT: string | number; MAX_TIMER_WAIT: string | number; SUM_LOCK_TIME: string | number; SUM_ROWS_AFFECTED: string | number; SUM_ROWS_SENT: string | number; SUM_ROWS_EXAMINED: string | number; SUM_NO_INDEX_USED: string | number };
const DIGEST_SQL = `SELECT DIGEST, DIGEST_TEXT, COUNT_STAR, SUM_TIMER_WAIT, MAX_TIMER_WAIT, SUM_LOCK_TIME, SUM_ROWS_AFFECTED, SUM_ROWS_SENT, SUM_ROWS_EXAMINED, SUM_NO_INDEX_USED
  FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME = ? AND COUNT_STAR > 0 AND DIGEST IS NOT NULL`;
const n = (v: string | number) => Number(v);

/** Clamp a performance_schema counter into a DECIMAL-safe range (UINT64 sentinels after TRUNCATE would overflow the columns). */
const safe = (v: number, max = 1e8): number => (Number.isFinite(v) && v >= 0 && v < max ? v : 0);

/** One digest row minus its optional before-snapshot, with sentinel/overflow protection. Exported for tests. */
export function digestDelta(r: DigestRow, b: DigestRow | undefined, cnt: number) {
  const totalMs = safe((n(r.SUM_TIMER_WAIT) - (b ? n(b.SUM_TIMER_WAIT) : 0)) / 1e9);
  const delta = (k: 'SUM_ROWS_EXAMINED' | 'SUM_ROWS_SENT' | 'SUM_ROWS_AFFECTED' | 'SUM_NO_INDEX_USED') => safe(n(r[k]) - (b ? n(b[k]) : 0), 1e18);
  return {
    digest: r.DIGEST, digestText: r.DIGEST_TEXT ?? '', execCount: cnt, avgMs: safe(totalMs / cnt),
    // MAX_TIMER_WAIT can hold a UINT64 sentinel; a single execution can never exceed the summed time.
    maxMs: Math.min(safe(n(r.MAX_TIMER_WAIT) / 1e9), totalMs),
    rowsExamined: delta('SUM_ROWS_EXAMINED'), rowsSent: delta('SUM_ROWS_SENT'), rowsAffected: delta('SUM_ROWS_AFFECTED'), noIndexUsed: delta('SUM_NO_INDEX_USED'),
    lockTimeMs: safe((n(r.SUM_LOCK_TIME) - (b ? n(b.SUM_LOCK_TIME) : 0)) / 1e9, 1e10), totalMs,
  };
}

/** Resets the digest counters at the start of the measured window (TRUNCATE); falls back to a before-snapshot when TRUNCATE is not permitted. */
export class DigestTracker {
  private before = new Map<string, DigestRow>();
  constructor(private conn: Connection, private database: string) {}
  async start(): Promise<void> {
    try { await this.conn.query('TRUNCATE TABLE performance_schema.events_statements_summary_by_digest'); this.before.clear(); }
    catch {
      const [rows] = await this.conn.query(DIGEST_SQL, [this.database]);
      this.before = new Map((rows as DigestRow[]).map((r) => [r.DIGEST, r]));
    }
  }
  async collect(): Promise<Array<{ digest: string; digestText: string; execCount: number; avgMs: number; maxMs: number; rowsExamined: number; rowsSent: number; rowsAffected: number; noIndexUsed: number; lockTimeMs: number; totalMs: number }>> {
    const [rows] = await this.conn.query(DIGEST_SQL, [this.database]);
    const out = [];
    for (const r of rows as DigestRow[]) {
      const b = this.before.get(r.DIGEST);
      const cnt = n(r.COUNT_STAR) - (b ? n(b.COUNT_STAR) : 0);
      if (cnt <= 0) continue;
      out.push(digestDelta(r, b, cnt));
    }
    return out;
  }
}

// ---------------------------------------------------------------- EXPLAIN
export interface PlanAccess { table: string; accessType: string; key: string | null; rows: number; condition: string | null }
export function plansAccesses(plan: unknown): PlanAccess[] {
  const out: PlanAccess[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.table_name === 'string' && typeof o.access_type === 'string') {
      out.push({ table: o.table_name, accessType: o.access_type, key: typeof o.key === 'string' ? o.key : null, rows: Number(o.rows_examined_per_scan ?? 0), condition: typeof o.attached_condition === 'string' ? o.attached_condition : null });
    }
    Object.values(o).forEach(walk);
  };
  walk(plan);
  return out;
}

const SQL_KEYWORDS = new Set(['where', 'on', 'using', 'join', 'left', 'right', 'inner', 'outer', 'cross', 'natural', 'group', 'order', 'limit', 'set', 'values', 'for', 'lock', 'union', 'having', 'straight_join']);
/** alias (or table name) -> table name, from FROM / JOIN / UPDATE / DELETE FROM / INSERT INTO. */
export function aliasMap(sql: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /\b(?:from|join|update|into)\s+`?([A-Za-z_][\w]*)`?(?:\s+(?:as\s+)?`?([A-Za-z_][\w]*)`?)?/gi;
  for (const m of sql.matchAll(re)) {
    const table = m[1]!; const alias = m[2];
    map.set(table, table);
    if (alias && !SQL_KEYWORDS.has(alias.toLowerCase())) map.set(alias, table);
  }
  return map;
}

/** Equality / IN predicate columns that the optimizer pushed onto `alias` (literals first, column-to-column equalities as a fallback). */
export function predicateColumns(alias: string, condition: string | null, sql: string): string[] {
  const lit: string[] = []; const colcol: string[] = [];
  const add = (list: string[], c: string) => { if (!list.includes(c)) list.push(c); };
  if (condition) {
    const me = `\`${alias}\`\\.\`(\\w+)\``;
    for (const m of condition.matchAll(new RegExp(`${me}\\s*(?:=|<=>)\\s*(\`[^=]*?\`\\.\`\\w+\`)?`, 'g'))) { if (m[2]) add(colcol, m[1]!); else add(lit, m[1]!); }
    for (const m of condition.matchAll(new RegExp(`${me}\\s+in\\s*\\(`, 'gi'))) add(lit, m[1]!);
    for (const m of condition.matchAll(new RegExp(`(?:\`[^\`]+\`\\.\`\\w+\`)\\s*=\\s*${me}`, 'g'))) add(colcol, m[1]!);
  }
  if (lit.length === 0 && colcol.length === 0) {
    // Fallback: parse the original SQL's WHERE for `alias.col = ` / `col = `.
    const where = sql.split(/\bwhere\b/i)[1]?.split(/\b(?:group by|order by|limit|for update|lock in)\b/i)[0] ?? '';
    for (const m of where.matchAll(new RegExp(`(?:\\b${alias}\\.)?\`?(\\w+)\`?\\s*=\\s*(?::|\\?|'|\\d)`, 'g'))) add(lit, m[1]!);
  }
  return lit.length ? lit : colcol;
}

export interface ExplainedStatement {
  txnName: string; variant: string; stepIndex: number; sql: string; explain: unknown | null; accesses: PlanAccess[]; digest: string | null; aliases: Map<string, string>;
}

/** EXPLAIN FORMAT=JSON for every statement template of every variant that ran, with sample parameters. */
export async function explainStatements(conn: Connection, design: DesignDoc, load: LoadResult): Promise<ExplainedStatement[]> {
  const out: ExplainedStatement[] = [];
  for (const txn of design.workload.transactions) {
    const variants = load.usedVariants[txn.name]; if (!variants) continue;
    const params = load.sampleParams(txn.name);
    for (const variant of variants) {
      const steps = txn.variants[variant as StrategyVariant] ?? txn.variants.default!;
      steps.forEach((step, stepIndex) => {
        out.push({ txnName: txn.name, variant, stepIndex, sql: step.sql, explain: null, accesses: [], digest: null, aliases: aliasMap(step.sql) });
      });
    }
    for (const e of out.filter((x) => x.txnName === txn.name && x.explain === null)) {
      const c = compileSql(e.sql);
      const values = c.slots.map((s) => (s.k === 'p' ? (params[s.name] ?? null) : 1));
      const literal = mysql.format(c.text, values);
      try {
        const [d] = await conn.query('SELECT STATEMENT_DIGEST(?) AS d', [literal]);
        e.digest = (d as Array<{ d: string }>)[0]?.d ?? null;
      } catch { /* digest function unavailable */ }
      try {
        const [rows] = await conn.query(`EXPLAIN FORMAT=JSON ${literal}`);
        const raw = (rows as Array<Record<string, unknown>>)[0]?.EXPLAIN;
        e.explain = typeof raw === 'string' ? JSON.parse(raw) : raw ?? null;
        e.accesses = plansAccesses(e.explain);
      } catch { e.explain = null; }
    }
  }
  return out;
}

const firstWord = (t: string) => (t.trim().split(/\s+/)[0] ?? '').toUpperCase();
/** Joins digest counters with the explained templates; keeps only workload statements (SELECT/INSERT/UPDATE/DELETE/WITH). */
export function buildStatementStats(digests: Awaited<ReturnType<DigestTracker['collect']>>, explained: ExplainedStatement[]): StatementStat[] {
  const byDigest = new Map<string, ExplainedStatement>();
  for (const e of explained) if (e.digest && !byDigest.has(e.digest)) byDigest.set(e.digest, e);
  return digests
    .filter((d) => byDigest.has(d.digest) || ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH'].includes(firstWord(d.digestText)))
    .sort((a, b) => b.totalMs - a.totalMs).slice(0, 60)
    .map((d) => ({
      digest: d.digest, digestText: d.digestText, txnName: byDigest.get(d.digest)?.txnName ?? null, execCount: d.execCount, avgMs: round(d.avgMs, 3), maxMs: round(d.maxMs, 3),
      rowsExamined: d.rowsExamined, rowsSent: d.rowsSent, rowsAffected: d.rowsAffected, noIndexUsed: d.noIndexUsed, lockTimeMs: round(d.lockTimeMs, 3),
      explain: byDigest.get(d.digest)?.explain ?? null,
    }));
}

// ---------------------------------------------------------------- SLO
export function sloVerdict(design: DesignDoc, load: { totals: { p95Ms: number; count: number; errored: number }; txnStats: Array<{ txnName: string; p95Ms: number; count: number }> }): SloVerdict {
  const reasons: string[] = [];
  const slo = design.slo;
  if (load.totals.p95Ms > slo.p95Ms) reasons.push(`p95 ${round(load.totals.p95Ms, 1)} ms exceeds the ${slo.p95Ms} ms target`);
  for (const [name, target] of Object.entries(slo.perTxn)) {
    const t = load.txnStats.find((x) => x.txnName === name);
    if (t && t.count > 0 && t.p95Ms > target) reasons.push(`${name} p95 ${round(t.p95Ms, 1)} ms exceeds its ${target} ms target`);
  }
  const errPct = load.totals.count > 0 ? (load.totals.errored / load.totals.count) * 100 : 0;
  if (errPct > slo.maxErrorPct) reasons.push(`error rate ${round(errPct, 2)}% exceeds the ${slo.maxErrorPct}% limit`);
  if (load.totals.count === 0) reasons.push('no transactions completed in the measured window');
  return { pass: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------- bottleneck
export function detectBottleneck(design: DesignDoc, load: LoadResult): Bottleneck | null {
  const M = load.totals.meanMs; if (M <= 0 || load.totals.count === 0) return null;
  const nameOf = (id: string | null) => design.nodes.find((x) => x.id === id)?.name ?? id ?? 'node';
  const cands: Array<{ score: number; b: Omit<Bottleneck, 'severity'> }> = [];
  for (const nd of load.nodes) {
    const q = nd.queueMs / M;
    if (q >= 0.15 || (nd.workerUtil >= 0.85 && q >= 0.08)) cands.push({ score: q, b: { nodeId: nd.nodeId, kind: 'app', reason: `${nameOf(nd.nodeId)}: requests wait ${round(nd.queueMs, 1)} ms in the worker queue (${Math.round(q * 100)}% of mean latency; workers ${Math.round(nd.workerUtil * 100)}% busy)` } });
    const p = nd.poolMs / M;
    if (p >= 0.15) cands.push({ score: p, b: { nodeId: nd.nodeId, kind: 'pool', reason: `${nameOf(nd.nodeId)}: waiting for a pooled connection takes ${round(nd.poolMs, 1)} ms (${Math.round(p * 100)}% of mean latency; pool ${Math.round(nd.poolUtil * 100)}% in use)` } });
  }
  const lockPerReq = load.totals.count ? load.db.rowLockTimeMs / load.totals.count : 0;
  const lockShare = lockPerReq / M;
  const saturated = load.topology.totalPool > 0 && load.db.threadsAvg >= 0.75 * load.topology.totalPool;
  const dbShare = load.phases.dbMs / M;
  const dbScore = Math.max(lockShare, saturated ? dbShare * 0.9 : 0);
  if (dbScore >= 0.15 && load.topology.mysqlNodeId) {
    cands.push({ score: dbScore, b: { nodeId: load.topology.mysqlNodeId, kind: 'db', reason: lockShare >= dbShare * 0.9 * (saturated ? 1 : 0) && lockShare >= 0.15
      ? `Database: row-lock waits average ${round(lockPerReq, 1)} ms per transaction (${Math.round(lockShare * 100)}% of mean latency; ${load.db.rowLockWaits} lock waits)`
      : `Database: ${round(load.db.threadsAvg, 1)} threads running on average; execution is ${Math.round(dbShare * 100)}% of mean latency` } });
  }
  if (load.cache.present && load.cache.ratio !== null && load.cache.hits + load.cache.misses >= 50 && load.cache.ratio < 0.3 && load.topology.redisNodeId) {
    cands.push({ score: (1 - load.cache.ratio) * 0.3, b: { nodeId: load.topology.redisNodeId, kind: 'cache', reason: `Cache hit ratio is only ${Math.round(load.cache.ratio * 100)}%: most cacheable reads still reach the database` } });
  }
  const netShare = load.phases.netMs / M;
  if (netShare >= 0.5 && load.nodes[0]) cands.push({ score: netShare * 0.8, b: { nodeId: load.nodes[0].nodeId, kind: 'network', reason: `Emulated network links account for ${Math.round(netShare * 100)}% of mean latency` } });
  cands.sort((a, b) => b.score - a.score);
  const top = cands[0];
  if (!top || top.score < 0.25) return null;
  return { ...top.b, severity: top.score >= 0.5 ? 'critical' : 'warning' };
}

// ---------------------------------------------------------------- findings
const SEV_ORDER: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 };
const indexName = (table: string, cols: string[]) => `ix_${table}_${cols.join('_')}`.slice(0, 64);

function tableHasIndexFor(t: Table | undefined, cols: string[]): boolean {
  if (!t) return false;
  const prefixOf = (list: string[]) => cols.every((c, i) => list[i] === c);
  return prefixOf(t.primaryKey) || t.uniques.some((u) => prefixOf(u.columns)) || t.indexes.some((i) => prefixOf(i.columns));
}

export interface FindingInput {
  design: DesignDoc;
  strategy: string;
  isolation: string;
  load: LoadResult;
  invariants: InvariantResult[];
  explained: ExplainedStatement[];
  statements: StatementStat[];
  slo: SloVerdict;
}

export function buildFindings(inp: FindingInput): Finding[] {
  const { design, load } = inp;
  const out: Omit<Finding, 'findingNo'>[] = [];
  const add = (severity: Severity, kind: FindingKind, title: string, explanation: string, evidence: Record<string, unknown>, fix: FindingFix | null = null, fixLabel?: string) =>
    out.push({ severity, kind, title, explanation, evidence, fix, ...(fixLabel ? { fixLabel } : {}) });
  const txns = design.workload.transactions;
  const hasVariant = (v: StrategyVariant, names?: string[]) => txns.some((t) => (!names || names.includes(t.name)) && t.variants[v] !== undefined);
  const saferStrategy = (names?: string[]): StrategyVariant | null => (['atomic', 'pessimistic', 'optimistic'] as StrategyVariant[]).find((v) => v !== inp.strategy && hasVariant(v, names)) ?? null;
  const M = load.totals.meanMs;

  // ---- invariants
  const failed = inp.invariants.filter((i) => !i.passed && !i.error && i.violations > 0);
  if (failed.length) {
    const naiveTxns = txns.filter((t) => strategyFor(t, inp.strategy) === 'naive' || (inp.strategy === 'naive' && t.variants.default !== undefined)).map((t) => t.name);
    const fixTo = saferStrategy();
    const names = failed.map((f) => `${f.name} (${f.violations})`).join(', ');
    add('HIGH', naiveTxns.length ? 'INVARIANT_NAIVE' : 'OTHER',
      naiveTxns.length ? `Invariant violated under the naive strategy: ${names}` : `Invariant violated under the ${inp.strategy} strategy: ${names}`,
      'Under REPEATABLE READ a plain read-then-write is a lost update: two transactions read the same stale value, both pass the check and both write, so the invariant breaks even though every transaction "committed". Making the check and the write one atomic statement (UPDATE ... WHERE guard), or locking the row first (SELECT ... FOR UPDATE under strict 2PL), serializes the conflicting transactions.',
      { invariants: failed.map((f) => ({ name: f.name, violations: f.violations })), strategy: inp.strategy, naiveTransactions: naiveTxns, isolation: inp.isolation },
      fixTo ? { type: 'SET_STRATEGY', strategy: fixTo } : null, fixTo ? `Use the ${fixTo} strategy` : undefined);
  }
  const errored = inp.invariants.filter((i) => i.error);
  for (const e of errored) add('LOW', 'OTHER', `Invariant ${e.name} could not be evaluated`, 'An invariant must be a single SELECT returning one number named violations. The statement failed when executed against the sandbox, so its result is not counted as a pass.', { invariant: e.name, error: e.error });

  // ---- deadlocks
  if (load.totals.deadlocks > 0) {
    const perTxn = load.txnStats.filter((t) => t.deadlocks > 0).map((t) => ({ txn: t.txnName, deadlocks: t.deadlocks, retries: t.retries }));
    const names = perTxn.map((p) => p.txn);
    const fixTo = (['pessimistic', 'atomic'] as StrategyVariant[]).find((v) => v !== inp.strategy && hasVariant(v, names)) ?? null;
    const rate = load.totals.count ? load.totals.deadlocks / load.totals.count : 0;
    add(rate >= 0.01 ? 'HIGH' : 'MEDIUM', 'DEADLOCK_ORDER', `${load.totals.deadlocks} deadlock${load.totals.deadlocks === 1 ? '' : 's'} (errno 1213) detected`,
      'InnoDB found cycles in its wait-for graph: transactions acquired row locks in different orders, each holding a lock the other needs. The detector aborts one victim and the application must retry it; acquiring locks in a single global order (for example lowest id first) makes cycles impossible.',
      { deadlocks: load.totals.deadlocks, rate: round(rate, 4), perTransaction: perTxn, retries: load.totals.retries },
      fixTo ? { type: 'SET_STRATEGY', strategy: fixTo } : null, fixTo ? `Use the ${fixTo} strategy` : undefined);
  }

  // ---- hot row
  const lockTotal = load.lockAgg.reduce((s, a) => s + a.count, 0);
  const top = load.lockAgg[0];
  if (top && load.lockSnapshotsWithWaits >= 2 && lockTotal >= 5 && top.count / lockTotal >= 0.3 && load.db.rowLockWaits >= 10) {
    const lockPerReq = load.totals.count ? load.db.rowLockTimeMs / load.totals.count : 0;
    const share = M > 0 ? lockPerReq / M : 0;
    const fixTo = saferStrategy(Object.keys(top.waitingTxns));
    add(share >= 0.3 ? 'HIGH' : share >= 0.1 ? 'MEDIUM' : 'LOW', 'HOT_ROW', `Lock waits concentrate on ${top.table}${top.lockData ? ` (key ${top.lockData})` : ''}`,
      `${Math.round((top.count / lockTotal) * 100)}% of the sampled lock waits queue on the same ${top.indexName ?? 'record'} lock. Under strict two-phase locking an exclusive row lock is held until commit, so writers to one hot row are serialized no matter how many connections the pool has. Shorten the critical section (atomic UPDATE), shard the counter, or queue the writes.`,
      { table: top.table, index: top.indexName, lockData: top.lockData, lockMode: top.lockMode, shareOfWaits: round(top.count / lockTotal, 3), rowLockWaits: load.db.rowLockWaits, avgLockWaitMs: round(load.db.rowLockWaits ? load.db.rowLockTimeMs / load.db.rowLockWaits : 0, 1), lockWaitShareOfLatency: round(share, 3), waiting: top.waitingTxns, blocking: top.blockingTxns },
      fixTo ? { type: 'SET_STRATEGY', strategy: fixTo } : null, fixTo ? `Use the ${fixTo} strategy` : undefined);
  }

  // ---- pool starvation
  const poolNode = [...load.nodes].sort((a, b) => b.poolMs - a.poolMs)[0];
  if (poolNode && M > 0 && poolNode.poolMs / M >= 0.2 && poolNode.poolMs >= 5) {
    const appNodes = design.nodes.flatMap((nd) => (nd.type === 'app' ? [nd] : []));
    const node = appNodes.find((a) => a.id === poolNode.nodeId);
    const totalInstances = appNodes.reduce((s, a) => s + a.config.instances, 0);
    let fix: FindingFix | null = null; let label: string | undefined;
    if (node) {
      const maxPerInstance = Math.min(100, Math.floor((MAX_TOTAL_POOL - (appNodes.reduce((s, a) => s + a.config.instances * a.config.poolSize, 0) - node.config.instances * node.config.poolSize)) / Math.max(1, node.config.instances)));
      const bigger = Math.min(node.config.poolSize * 2, maxPerInstance);
      if (bigger > node.config.poolSize) { fix = { type: 'SET_POOL', poolSize: bigger }; label = `Set pool size to ${bigger}`; }
      else if (node.config.instances < 8 && (totalInstances + 1) * node.config.poolSize <= MAX_TOTAL_POOL) { fix = { type: 'SET_INSTANCES', instances: node.config.instances + 1 }; label = `Run ${node.config.instances + 1} instances`; }
    }
    const lockBound = load.db.rowLockTimeMs / Math.max(1, load.totals.count) > poolNode.poolMs * 0.5;
    add(lockBound ? 'MEDIUM' : poolNode.poolMs / M >= 0.5 ? 'HIGH' : 'MEDIUM', 'POOL_STARVATION', `Requests wait ${round(poolNode.poolMs, 1)} ms for a database connection`,
      'A connection pool is a bounded resource: when all connections are checked out, further requests queue (Little\'s law: waiting time grows with arrival rate times service time). A larger pool, or more app instances, raises DB concurrency; if connections are mostly held while waiting on locks, more of them only moves the queue into InnoDB.',
      { nodeId: poolNode.nodeId, poolWaitMs: round(poolNode.poolMs, 2), shareOfMeanLatency: round(poolNode.poolMs / M, 3), poolUtilization: round(poolNode.poolUtil, 3), poolSize: node?.config.poolSize, instances: node?.config.instances, lockWaitsDominate: lockBound },
      fix, label);
  }

  // ---- cache
  const lookups = load.cache.hits + load.cache.misses;
  if (load.cache.present && load.cache.ratio !== null && lookups >= 50 && load.cache.ratio < 0.5) {
    const ttl = design.nodes.find((x) => x.type === 'redis');
    add(load.cache.ratio < 0.2 ? 'MEDIUM' : 'LOW', 'LOW_CACHE_HIT', `Cache hit ratio is ${Math.round(load.cache.ratio * 100)}%`,
      'Cache-aside only helps when the same key is requested again before its TTL expires. A low hit ratio means the key space (template plus parameters) is too wide or the TTL too short, so most reads pay the cache lookup and still reach the database.',
      { hitRatio: round(load.cache.ratio, 3), hits: load.cache.hits, misses: load.cache.misses, ttlS: ttl?.type === 'redis' ? ttl.config.ttlS : null, cacheable: txns.filter((t) => t.cacheable).map((t) => t.name) });
  }

  // ---- serializable cost
  const serializableVariant = Object.values(load.usedVariants).some((v) => v.includes('serializable'));
  if ((inp.isolation === 'SERIALIZABLE' || serializableVariant) && (load.db.rowLockWaits > 0 || load.totals.deadlocks > 0 || load.totals.lockTimeouts > 0)) {
    add(load.totals.deadlocks > 0 || load.totals.lockTimeouts > 0 ? 'MEDIUM' : 'LOW', 'SERIALIZABLE_COST', 'SERIALIZABLE adds locking cost',
      'At SERIALIZABLE, InnoDB turns plain consistent reads into shared next-key lock reads, so readers block writers and two transactions that read then upgrade the same range deadlock. It prevents write skew and phantoms but trades throughput and retries for that guarantee.',
      { isolation: inp.isolation, serializableTransactions: Object.entries(load.usedVariants).filter(([, v]) => v.includes('serializable')).map(([k]) => k), rowLockWaits: load.db.rowLockWaits, deadlocks: load.totals.deadlocks, lockTimeouts: load.totals.lockTimeouts, retries: load.totals.retries });
  }

  // ---- full table scans from EXPLAIN
  const seen = new Set<string>();
  for (const e of inp.explained) {
    for (const a of e.accesses) {
      if (a.accessType !== 'ALL' || a.rows < 1000) continue;
      const table = e.aliases.get(a.table) ?? a.table;
      const schemaTable = design.schema.tables.find((t) => t.name === table);
      if (!schemaTable) continue;
      const cols = predicateColumns(a.table, a.condition, e.sql).filter((c) => schemaTable.columns.some((x) => x.name === c));
      const key = `${table}:${cols.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const stat = inp.statements.find((s) => s.txnName === e.txnName && s.explain === e.explain) ?? inp.statements.find((s) => s.txnName === e.txnName);
      const covered = cols.length > 0 && tableHasIndexFor(schemaTable, cols);
      const fix: FindingFix | null = cols.length && !covered ? { type: 'ADD_INDEX', table, columns: cols, name: indexName(table, cols) } : null;
      add(a.rows >= 10_000 ? 'HIGH' : 'MEDIUM', 'FULL_SCAN', `Full table scan on ${table}${cols.length ? ` (filter on ${cols.join(', ')})` : ''}`,
        `The optimizer reads every row of ${table} (access type ALL, about ${a.rows.toLocaleString('en-US')} rows) because no index serves the predicate. Without an index the cost per execution grows linearly with table size; a B+tree index on the filtered column(s) turns the scan into a logarithmic lookup that reads only the matching rows.`,
        { table, accessType: a.accessType, estimatedRows: a.rows, filterColumns: cols, transaction: e.txnName, statement: e.sql, digest: stat?.digest ?? e.digest, digestText: stat?.digestText, avgMs: stat?.avgMs, rowsExaminedPerExec: stat && stat.execCount ? Math.round(stat.rowsExamined / stat.execCount) : null },
        fix, fix ? `Add index on ${table}(${cols.join(', ')})` : undefined);
    }
  }

  // ---- model-level: FK columns without an explicit index (InnoDB adds an implicit one, hence INFO)
  let fkCount = 0;
  for (const t of design.schema.tables) {
    for (const fk of t.foreignKeys) {
      if (fkCount >= 3) break;
      if (tableHasIndexFor(t, fk.columns)) continue;
      fkCount++;
      add('INFO', 'FK_NO_INDEX', `Foreign key ${t.name}(${fk.columns.join(', ')}) has no explicit index`,
        'InnoDB requires an index on foreign-key columns and silently creates one if you do not, so the checks stay fast; declaring it makes the schema explicit and lets you choose its column order. Without any index, every parent delete or update would scan the child table.',
        { table: t.name, columns: fk.columns, refTable: fk.refTable },
        { type: 'ADD_INDEX', table: t.name, columns: fk.columns, name: indexName(t.name, fk.columns) }, `Add explicit index on ${t.name}(${fk.columns.join(', ')})`);
    }
  }

  // ---- SLO
  if (!inp.slo.pass) add('HIGH', 'SLO', 'SLO not met', 'The service-level objective is a contract on tail latency and error rate; a breach under the tested load means the design needs more capacity or less contention before it can promise this behaviour. See the bottleneck and the findings above for the likely cause.', { reasons: inp.slo.reasons, p95Ms: load.totals.p95Ms, tpsAvg: load.totals.tpsAvg });

  return out.map((f, i) => ({ ...f, findingNo: i + 1 })).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]).map((f, i) => ({ ...f, findingNo: i + 1 }));
}
