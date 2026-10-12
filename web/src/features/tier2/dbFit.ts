// "Which database fits?" heuristics. Rule-based over the design document: no measurements, no model. Pure and unit-tested.
import type { DesignDoc, Transaction, ValueGenerator } from '@datasim/shared';

export const FIT_DISCLAIMER = 'Heuristic, rule-based. Not a benchmark.';

export interface FitMetrics {
  totalWeight: number;
  /** Shares of the transaction mix, 0..1. */
  readShare: number;
  writeShare: number;
  /** Read-only AND cacheable. */
  cacheableShare: number;
  /** Write transactions whose parameters are skewed (zipf), i.e. they pile onto few rows. */
  hotWriteShare: number;
  hotTxns: Array<{ name: string; param: string; s: number }>;
  /** Write transactions with two or more DML statements. */
  multiStatementWrites: string[];
  invariants: number;
  foreignKeys: number;
  checks: number;
  /** Read statements that aggregate (GROUP BY, COUNT, SUM, AVG) without a LIMIT. */
  scanReads: string[];
  vus: number;
  seedRows: number;
  largestTableRows: number;
  hasCacheNode: boolean;
  /** Every statement is a single-table lookup/update by key (no joins, no aggregates). */
  keyValueOnly: boolean;
  strategy: string | null;
}

export type FitLevel = 'strong' | 'good' | 'consider' | 'caution';
export interface Recommendation {
  id: 'relational-oltp' | 'cache' | 'read-replica' | 'hot-row' | 'columnar' | 'write-ceiling' | 'key-value' | 'no-workload';
  level: FitLevel;
  title: string;
  /** Two or three sentences of reasoning. */
  reasoning: string;
  /** The design facts the rule fired on. */
  evidence: string[];
}
export interface FitResult { metrics: FitMetrics; recommendations: Recommendation[] }

const pct = (v: number) => `${Math.round(v * 100)}%`;
const list = (xs: string[]) => (xs.length <= 3 ? xs.join(', ') : `${xs.slice(0, 3).join(', ')} +${xs.length - 3}`);
const isWriteSql = (sql: string) => /^\s*(insert|update|delete|replace)\b/i.test(sql);
const stepsOf = (t: Transaction) => t.variants.default ?? Object.values(t.variants)[0] ?? [];

function skewOf(g: ValueGenerator): number | null {
  if (g.kind === 'zipf') return g.s;
  if ((g.kind === 'fromTable' || g.kind === 'fkRef') && g.dist === 'zipf') return g.s;
  return null;
}

export function fitMetrics(design: Pick<DesignDoc, 'nodes' | 'schema' | 'workload'>): FitMetrics {
  const txns = design.workload.transactions;
  const total = txns.reduce((n, t) => n + t.weight, 0);
  const share = (pick: (t: Transaction) => boolean) => (total > 0 ? txns.filter(pick).reduce((n, t) => n + t.weight, 0) / total : 0);

  const hotTxns: FitMetrics['hotTxns'] = [];
  for (const t of txns) {
    if (t.readOnly || t.weight <= 0) continue;
    for (const [param, g] of Object.entries(t.params)) {
      const s = skewOf(g);
      if (s !== null && s >= 0.8) { hotTxns.push({ name: t.name, param, s }); break; }
    }
  }
  const hotNames = new Set(hotTxns.map((h) => h.name));

  const multiStatementWrites = txns.filter((t) => !t.readOnly && stepsOf(t).filter((s) => isWriteSql(s.sql)).length >= 2).map((t) => t.name);
  const scanReads = txns.filter((t) => t.readOnly && stepsOf(t).some((s) => /\b(group\s+by|count\s*\(|sum\s*\(|avg\s*\()/i.test(s.sql) && !/\blimit\b/i.test(s.sql))).map((t) => t.name);
  const keyValueOnly = txns.length > 0 && txns.every((t) => stepsOf(t).every((s) => !/\bjoin\b|\bgroup\s+by\b|\bcount\s*\(|\bsum\s*\(|\bavg\s*\(|\bunion\b/i.test(s.sql) && (s.sql.match(/\bfrom\b/gi)?.length ?? 0) <= 1));

  const users = design.nodes.find((n) => n.type === 'users');
  const app = design.nodes.find((n) => n.type === 'app');
  const rows = design.schema.tables.map((t) => t.seedRows);
  return {
    totalWeight: total,
    readShare: share((t) => t.readOnly),
    writeShare: share((t) => !t.readOnly),
    cacheableShare: share((t) => t.readOnly && t.cacheable),
    hotWriteShare: share((t) => hotNames.has(t.name)),
    hotTxns,
    multiStatementWrites,
    invariants: design.workload.invariants.length,
    foreignKeys: design.schema.tables.reduce((n, t) => n + t.foreignKeys.length, 0),
    checks: design.schema.tables.reduce((n, t) => n + t.checks.length, 0),
    scanReads,
    vus: users?.type === 'users' ? users.config.vus : 0,
    seedRows: rows.reduce((a, b) => a + b, 0),
    largestTableRows: Math.max(0, ...rows),
    hasCacheNode: design.nodes.some((n) => n.type === 'redis'),
    keyValueOnly,
    strategy: app?.type === 'app' ? app.config.strategy : null,
  };
}

export function dbFit(design: Pick<DesignDoc, 'nodes' | 'schema' | 'workload'>): FitResult {
  const m = fitMetrics(design);
  const rec: Recommendation[] = [];

  if (m.totalWeight === 0) {
    rec.push({ id: 'no-workload', level: 'consider', title: 'Define a workload first', reasoning: 'The advice depends on the transaction mix. Add transactions in the workload editor and weight them.', evidence: ['0 transactions with weight > 0'] });
    return { metrics: m, recommendations: rec };
  }

  // 1. relational OLTP with strong consistency
  const needsAcid = m.multiStatementWrites.length > 0 || m.invariants > 0;
  if (m.writeShare > 0 && (needsAcid || m.foreignKeys > 0)) {
    const ev = [
      `${pct(m.writeShare)} of the mix writes`,
      ...(m.multiStatementWrites.length ? [`multi-statement write transactions: ${list(m.multiStatementWrites)}`] : []),
      ...(m.invariants ? [`${m.invariants} invariant${m.invariants === 1 ? '' : 's'} that must hold`] : []),
      ...(m.foreignKeys ? [`${m.foreignKeys} foreign key${m.foreignKeys === 1 ? '' : 's'}`] : []),
      ...(m.checks ? [`${m.checks} CHECK constraint${m.checks === 1 ? '' : 's'}`] : []),
    ];
    rec.push({
      id: 'relational-oltp', level: 'strong', title: 'Stay on MySQL / InnoDB',
      reasoning: 'Several statements must commit or fail together and the data has rules that must never be violated. That is what ACID transactions, row locks, foreign keys and CHECK constraints are for. Moving to an eventually consistent store would push those guarantees into application code.',
      evidence: ev,
    });
  } else if (m.writeShare === 0) {
    rec.push({
      id: 'relational-oltp', level: 'good', title: 'MySQL / InnoDB is fine; reads dominate',
      reasoning: 'A read-only mix has no write conflicts, so the relational model costs little. The levers are indexes, caching and read capacity rather than a different database.',
      evidence: ['0% writes in the transaction mix'],
    });
  } else {
    rec.push({
      id: 'relational-oltp', level: 'good', title: 'MySQL / InnoDB is a reasonable default',
      reasoning: 'Writes are simple and independent: no multi-statement transactions, invariants or foreign keys were found. A relational database still works; a key-value store would work too if the access paths stay this simple.',
      evidence: [`${pct(m.writeShare)} of the mix writes`],
    });
  }

  // 2. caching
  if (m.cacheableShare >= 0.2 || (m.readShare >= 0.7 && m.cacheableShare > 0)) {
    rec.push(m.hasCacheNode
      ? { id: 'cache', level: 'good', title: 'Keep the Redis cache',
          reasoning: `About ${pct(m.cacheableShare)} of requests are cacheable reads and a cache node is already in the design. The hit ratio depends on the TTL and on how skewed the keys are; the run report shows the measured ratio.`,
          evidence: [`${pct(m.cacheableShare)} cacheable reads`, 'cache node present'] }
      : { id: 'cache', level: 'strong', title: 'Add a Redis cache (cache-aside)',
          reasoning: `About ${pct(m.cacheableShare)} of requests are reads marked cacheable. Serving them from memory removes that share of load from InnoDB. The cost is stale reads up to the TTL, so only cache data that tolerates it.`,
          evidence: [`${pct(m.cacheableShare)} cacheable reads`, 'no cache node in the topology'] });
  } else if (m.readShare >= 0.7 && m.cacheableShare === 0) {
    rec.push({ id: 'cache', level: 'consider', title: 'Mark read transactions cacheable',
      reasoning: `${pct(m.readShare)} of the mix is read-only but none of it is marked cacheable. If those reads can be a few seconds stale, mark them cacheable and add a Redis node.`,
      evidence: [`${pct(m.readShare)} reads`, '0% marked cacheable'] });
  }

  // 3. read replica
  if (m.readShare >= 0.8 && m.vus >= 100) {
    rec.push({ id: 'read-replica', level: 'consider', title: 'Read replica for read scaling',
      reasoning: 'A read-dominated mix at this concurrency can be spread over replicas with asynchronous replication. Replica reads can lag the primary, so route only reads that tolerate it. DataSim does not model replicas; this is advice for the real system.',
      evidence: [`${pct(m.readShare)} reads`, `${m.vus} virtual users`] });
  }

  // 4. hot-row contention
  if (m.hotWriteShare >= 0.2) {
    const h = m.hotTxns[0]!;
    rec.push({ id: 'hot-row', level: 'caution', title: 'Hot-row contention: avoid read-modify-write',
      reasoning: `${pct(m.hotWriteShare)} of the mix writes with skewed keys (zipf s = ${h.s}), so many transactions queue on the same few rows. Use a single atomic UPDATE (SET n = n + 1 WHERE n < cap), shard the counter across rows, or serialize through a queue. Under REPEATABLE READ a read-then-write sequence will lose updates.`,
      evidence: [...m.hotTxns.slice(0, 3).map((x) => `${x.name}.${x.param} is zipf (s = ${x.s})`), ...(m.strategy ? [`strategy: ${m.strategy}`] : [])] });
  }

  // 5. analytics-style scans
  if (m.scanReads.length > 0) {
    const big = m.largestTableRows >= 100_000;
    rec.push({ id: 'columnar', level: big ? 'consider' : 'caution', title: 'Move analytics scans to a columnar store',
      reasoning: `${list(m.scanReads)} aggregate over rows without a LIMIT. ${big ? `With tables of ${m.largestTableRows.toLocaleString('en-US')} rows` : 'As the tables grow'} these scans compete with OLTP traffic for the buffer pool. A columnar engine (ClickHouse, DuckDB) fed from MySQL suits reporting; keep transactional work on InnoDB.`,
      evidence: [`aggregating reads: ${list(m.scanReads)}`, `largest table ${m.largestTableRows.toLocaleString('en-US')} rows`] });
  }

  // 6. write ceiling
  if (m.writeShare >= 0.5 && m.vus >= 100) {
    rec.push({ id: 'write-ceiling', level: 'caution', title: 'Single-primary write ceiling',
      reasoning: 'InnoDB commits every write through one primary and one redo log. With a write-heavy mix at this concurrency, throughput flattens at that ceiling. Keep transactions short, batch where the business allows, and run the capacity test to see where the knee is. Sharding by key is the next step only if the knee is below the target.',
      evidence: [`${pct(m.writeShare)} writes`, `${m.vus} virtual users`] });
  }

  // 7. key-value alternative
  if (m.keyValueOnly && m.invariants === 0 && m.multiStatementWrites.length === 0 && m.foreignKeys === 0) {
    rec.push({ id: 'key-value', level: 'consider', title: 'A key-value store would also fit',
      reasoning: 'Every statement touches a single table by key: no joins, aggregates, multi-statement transactions or constraints. A key-value or document store could serve this with less overhead, at the price of ad-hoc querying and cross-row guarantees.',
      evidence: ['single-table statements only', '0 invariants, 0 foreign keys'] });
  }

  return { metrics: m, recommendations: rec };
}
