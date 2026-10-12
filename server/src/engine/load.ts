// Closed-loop workload runner (brief 4.1 / 4.4).
// Request path: VU -> (link) -> [LB] -> (link) -> App instance (bounded workers + FIFO queue, emulated processing time)
//   -> [Redis cache-aside] -> real mysql2 pool connection -> real transaction at the configured isolation -> response.
// Every phase is stamped with process.hrtime.bigint() so the "where the time went" breakdown is measured.
import { Redis } from 'ioredis';
import type { Connection, Pool, PoolConnection } from 'mysql2/promise';
import { Rng, SOCKET_EVENTS, makeGenerator, strategyFor } from '@datasim/shared';
import type {
  AppConfig, DesignDoc, DesignEdge, GenFn, Isolation, LockWaitRow, RunLocksEvent, RunSample, RunSampleEvent, RunStatusEvent, StrategyVariant, Transaction, TxnStat, UsersConfig,
} from '@datasim/shared';
import { config } from '../config.js';
import { createRunnerPool } from '../db/runner.js';
import { ServiceError } from '../services/liveStrategy.js';
import { actionFor, classifyError, isFatal } from './classify.js';
import { CasRetry, TxnReject, compileStep, execSteps } from './exec.js';
import type { CompiledStep, Params } from './exec.js';
import { Histogram, clamp, hr, msSince, round, sleep } from './util.js';
import { adminConnect } from './admin.js';

export type Pattern = UsersConfig['pattern'];

export interface LoadPlan {
  runId: string;
  design: DesignDoc;
  database: string;
  vus: number;
  pattern: Pattern;
  durationS: number;
  warmupS: number;
  strategy?: StrategyVariant;
  isolation: Isolation;
  seed: number;
  /** Added to every emitted/stored sample tS (capacity steps are laid end to end). */
  sampleOffsetS?: number;
  step?: { n: number; of: number; vus: number };
  emit: (event: string, payload: unknown) => void;
  isCancelled: () => boolean;
  /** Awaited once when the measured window begins (resets digest counters). */
  onMeasureStart?: () => Promise<void>;
}

/** VUs that should be active at time `t` seconds after load start. Exposed for tests. */
export function targetVus(pattern: Pattern, vus: number, t: number, warmupS: number, durationS: number): number {
  const total = warmupS + durationS;
  switch (pattern) {
    case 'constant': return vus;
    case 'ramp': return clamp(Math.ceil(vus * Math.min(1, (t + 0.5) / Math.max(1, warmupS + durationS / 2))), 1, vus);
    case 'spike': {
      const base = Math.max(1, Math.round(vus * 0.2));
      return t >= warmupS + durationS * 0.1 && t < warmupS + durationS * 0.6 ? vus : base;
    }
    case 'step': return clamp(Math.ceil(vus * (Math.floor((t / Math.max(1, total)) * 4) + 1) / 4), 1, vus);
  }
}

// ---------------------------------------------------------------- aggregates
class Win {
  hist = new Histogram();
  served = 0; errors = 0; retries = 0; deadlocks = 0; lockTimeouts = 0;
  reset(): void { this.hist.reset(); this.served = 0; this.errors = 0; this.retries = 0; this.deadlocks = 0; this.lockTimeouts = 0; }
}

class TxnAgg {
  count = 0; committed = 0; rejected = 0; errored = 0; retries = 0; deadlocks = 0; lockTimeouts = 0;
  hist = new Histogram();
  queue = 0; net = 0; app = 0; pool = 0; db = 0;
}

class Rec {
  queue = 0; net = 0; app = 0; pool = 0; db = 0;
  retries = 0; deadlocks = 0; lockTimeouts = 0;
  /** 0 committed, 1 rejected, 2 errored */
  outcome = 0;
  reason = '';
  cacheHit = false;
}

/** Duck-typed Rng that forwards to the current VU's stream, so generators (and their zipf CDFs) are built once and shared. */
class RngProxy {
  cur!: Rng;
  float() { return this.cur.float(); }
  int(a: number, b: number) { return this.cur.int(a, b); }
  pick<T>(items: readonly T[]) { return this.cur.pick(items); }
  gaussian() { return this.cur.gaussian(); }
  exponential(m: number) { return this.cur.exponential(m); }
  weighted<T>(items: readonly T[], w: readonly number[]) { return this.cur.weighted(items, w); }
}

interface Hop { latencyMs: number; jitterMs: number }
interface NodeAgg { nodeId: string; win: Win; count: number; queueMs: number; poolMs: number; appMs: number; netMs: number; busyAtStart: number; instances: Instance[] }

class Instance {
  inflight = 0;
  queue: Array<() => void> = [];
  poolInUse = 0;
  poolWaiting = 0;
  busyNs = 0;
  constructor(readonly nodeId: string, readonly idx: number, readonly cfg: AppConfig, readonly strategy: StrategyVariant, readonly pool: Pool, readonly dbHop: Hop, readonly redisHop: Hop | null, readonly agg: NodeAgg) {}
  acquire(): Promise<void> | undefined {
    if (this.inflight < this.cfg.workers) { this.inflight++; return undefined; }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }
  release(): void {
    const next = this.queue.shift();
    if (next) next(); else this.inflight--;
  }
}
interface Target { inst: Instance; hop: Hop }
interface Entry { lb: { algo: 'round-robin' | 'least-connections'; hop: Hop; nodeId: string } | null; targets: Target[]; rr: number }

interface TxnRt {
  def: Transaction; name: string; readOnly: boolean; cacheable: boolean;
  paramNames: string[]; gens: GenFn[]; counter: number;
  steps: Map<string, CompiledStep[]>; agg: TxnAgg;
}
interface Vu { id: number; rng: Rng; started: boolean }

export interface LockAgg { table: string; indexName: string | null; lockMode: string; lockData: string | null; count: number; waitingTxns: Record<string, number>; blockingTxns: Record<string, number> }
export interface NodeSummary {
  nodeId: string; count: number; queueMs: number; poolMs: number; appMs: number; netMs: number;
  workerUtil: number; poolUtil: number; workers: number; poolMax: number; instances: number;
}
export interface LoadResult {
  samples: RunSample[];
  txnStats: TxnStat[];
  totals: { count: number; committed: number; rejected: number; errored: number; retries: number; deadlocks: number; lockTimeouts: number; tpsAvg: number; p50Ms: number; p95Ms: number; p99Ms: number; meanMs: number };
  nodes: NodeSummary[];
  /** Mean ms per request across all transactions: queue/net/app/pool/db. */
  phases: { queueMs: number; netMs: number; appMs: number; poolMs: number; dbMs: number };
  db: { threadsAvg: number; threadsMax: number; rowLockWaits: number; rowLockTimeMs: number; bpRequests: number; bpReads: number; comSelect: number; comWrite: number };
  cache: { present: boolean; hits: number; misses: number; errors: number; ratio: number | null };
  lockWaits: LockWaitRow[];
  lockAgg: LockAgg[];
  lockSnapshots: number;
  lockSnapshotsWithWaits: number;
  errorBreakdown: Record<string, number>;
  measuredS: number;
  cancelled: boolean;
  /** Transactions -> variants that were actually executed (for EXPLAIN). */
  usedVariants: Record<string, string[]>;
  /** Draws a deterministic sample parameter set for a transaction (EXPLAIN / test once). */
  sampleParams: (txnName: string) => Params;
  /** Resolved topology facts the analysis needs. */
  topology: { appNodeIds: string[]; mysqlNodeId: string | null; redisNodeId: string | null; usersNodeId: string | null; lbNodeId: string | null; totalPool: number; poolPerInstance: number; instances: number };
}

// ---------------------------------------------------------------- redis
export async function pingRedis(): Promise<string | null> {
  const r = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 1500, retryStrategy: () => null, enableOfflineQueue: false });
  r.on('error', () => undefined);
  try { await r.connect(); await r.ping(); return null; } catch (e) { return (e as Error).message; } finally { r.disconnect(); }
}

// ---------------------------------------------------------------- DB-side samplers
const STATUS_VARS = ['Threads_running', 'Innodb_row_lock_waits', 'Innodb_row_lock_time', 'Innodb_buffer_pool_read_requests', 'Innodb_buffer_pool_reads'];
// Global Com_* status counters are only merged when a session closes, so pooled sessions would never show; the statement instrumentation is live.
const COM_EVENTS: Record<string, string> = { 'statement/sql/select': 'Com_select', 'statement/sql/insert': 'Com_insert', 'statement/sql/update': 'Com_update', 'statement/sql/delete': 'Com_delete' };

class DbSampler {
  private prev: Record<string, number> | null = null;
  private polling = false;
  pending = { lockWaits: 0, lockMs: 0, bpReq: 0, bpReads: 0, threads: 0 };
  measuring = false;
  totals = { lockWaits: 0, lockMs: 0, bpReq: 0, bpReads: 0, comSelect: 0, comWrite: 0, threadSum: 0, threadN: 0, threadMax: 0 };
  constructor(private conn: Connection) {}

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const [rows] = await this.conn.query(`SELECT VARIABLE_NAME AS n, VARIABLE_VALUE AS v FROM performance_schema.global_status WHERE VARIABLE_NAME IN (${STATUS_VARS.map((v) => `'${v}'`).join(',')})`);
      const cur: Record<string, number> = {};
      for (const r of rows as Array<{ n: string; v: string }>) cur[r.n] = Number(r.v);
      const [evs] = await this.conn.query(`SELECT EVENT_NAME AS n, COUNT_STAR AS v FROM performance_schema.events_statements_summary_global_by_event_name WHERE EVENT_NAME IN (${Object.keys(COM_EVENTS).map((e) => `'${e}'`).join(',')})`);
      for (const r of evs as Array<{ n: string; v: string }>) cur[COM_EVENTS[r.n]!] = Number(r.v);
      const prev = this.prev; this.prev = cur;
      // The sampler's own connection is counted in Threads_running.
      const threads = Math.max(0, (cur.Threads_running ?? 1) - 1);
      this.pending.threads = threads;
      if (!prev) return;
      const d = (k: string) => Math.max(0, (cur[k] ?? 0) - (prev[k] ?? 0));
      this.pending.lockWaits += d('Innodb_row_lock_waits'); this.pending.lockMs += d('Innodb_row_lock_time');
      this.pending.bpReq += d('Innodb_buffer_pool_read_requests'); this.pending.bpReads += d('Innodb_buffer_pool_reads');
      if (this.measuring) {
        const t = this.totals;
        t.lockWaits += d('Innodb_row_lock_waits'); t.lockMs += d('Innodb_row_lock_time');
        t.bpReq += d('Innodb_buffer_pool_read_requests'); t.bpReads += d('Innodb_buffer_pool_reads');
        t.comSelect += d('Com_select'); t.comWrite += d('Com_insert') + d('Com_update') + d('Com_delete');
        t.threadSum += threads; t.threadN++; t.threadMax = Math.max(t.threadMax, threads);
      }
    } catch { /* keep the previous baseline; a missed poll only coarsens one sample */ } finally { this.polling = false; }
  }

  take() {
    const p = this.pending;
    const out = { threadsRunning: p.threads, rowLockWaits: p.lockWaits, lockWaitMs: p.lockMs, bpHitRatio: p.bpReq > 0 ? clamp(1 - p.bpReads / p.bpReq, 0, 1) : null };
    p.lockWaits = 0; p.lockMs = 0; p.bpReq = 0; p.bpReads = 0;
    return out;
  }
}

const LOCK_SQL = `
  SELECT rt.PROCESSLIST_ID AS waiting_conn, bt.PROCESSLIST_ID AS blocking_conn,
         l.OBJECT_NAME AS tbl, l.INDEX_NAME AS idx, l.LOCK_MODE AS mode, l.LOCK_DATA AS data
    FROM performance_schema.data_lock_waits w
    JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
    LEFT JOIN performance_schema.threads rt ON rt.THREAD_ID = w.REQUESTING_THREAD_ID
    LEFT JOIN performance_schema.threads bt ON bt.THREAD_ID = w.BLOCKING_THREAD_ID
   WHERE l.OBJECT_SCHEMA = ? LIMIT 200`;

const MAX_LOCK_ROWS = 500;

// ---------------------------------------------------------------- the runner
export async function runLoad(plan: LoadPlan): Promise<LoadResult> {
  const { design } = plan;
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  const usersNode = design.nodes.find((n) => n.type === 'users');
  const mysqlNode = design.nodes.find((n) => n.type === 'mysql');
  const redisNode = design.nodes.find((n) => n.type === 'redis');
  const lbNode = design.nodes.find((n) => n.type === 'lb');
  if (!usersNode || usersNode.type !== 'users' || !mysqlNode || mysqlNode.type !== 'mysql') throw new ServiceError(400, 'INVALID_DESIGN', 'The design needs a Users node and a Database node');
  const users = usersNode.config;
  const mysqlCfg = mysqlNode.config;
  const hopOf = (e: DesignEdge | undefined): Hop => ({ latencyMs: e?.latencyMs ?? 0, jitterMs: e?.jitterMs ?? 0 });
  const edgeBetween = (a: string, b: string) => design.edges.find((e) => e.source === a && e.target === b);

  const rng = Rng.derive(plan.seed, 'runtime');
  const pools: Pool[] = [];
  const connTxn = new Map<number, string>();
  const sessionIso = mysqlCfg.isolation;

  // ---- topology: app nodes reachable from Users that connect to the database
  const nodeAggs = new Map<string, NodeAgg>();
  const instOfNode = new Map<string, Instance[]>();
  const makeInstances = (nodeId: string): Instance[] => {
    const hit = instOfNode.get(nodeId); if (hit) return hit;
    const node = byId.get(nodeId);
    if (!node || node.type !== 'app') return [];
    const dbEdge = edgeBetween(nodeId, mysqlNode.id);
    if (!dbEdge) return [];
    const redisEdge = redisNode ? edgeBetween(nodeId, redisNode.id) : undefined;
    const agg: NodeAgg = { nodeId, win: new Win(), count: 0, queueMs: 0, poolMs: 0, appMs: 0, netMs: 0, busyAtStart: 0, instances: [] };
    nodeAggs.set(nodeId, agg);
    const list: Instance[] = [];
    for (let i = 0; i < node.config.instances; i++) {
      const pool = createRunnerPool(plan.database, node.config.poolSize);
      const iso = sessionIso.replace(/ /g, '-');
      pool.pool.on('connection', (c: { query: (sql: string, cb: (e: unknown) => void) => void }) => {
        c.query(`SET SESSION innodb_lock_wait_timeout = ${Math.round(mysqlCfg.lockWaitTimeoutS)}, transaction_isolation = '${iso}', max_execution_time = ${Math.round(mysqlCfg.maxExecutionTimeMs)}`, () => undefined);
      });
      pools.push(pool);
      const inst = new Instance(nodeId, i, node.config, plan.strategy ?? node.config.strategy, pool, hopOf(dbEdge), redisEdge ? hopOf(redisEdge) : null, agg);
      list.push(inst);
    }
    agg.instances = list;
    instOfNode.set(nodeId, list);
    return list;
  };

  const entries: Entry[] = [];
  for (const e of design.edges.filter((x) => x.source === usersNode.id)) {
    const target = byId.get(e.target);
    if (!target) continue;
    if (target.type === 'app') {
      const insts = makeInstances(target.id);
      if (insts.length) entries.push({ lb: null, rr: 0, targets: insts.map((inst) => ({ inst, hop: hopOf(e) })) });
    } else if (target.type === 'lb') {
      const targets: Target[] = [];
      for (const le of design.edges.filter((x) => x.source === target.id)) for (const inst of makeInstances(le.target)) targets.push({ inst, hop: hopOf(le) });
      if (targets.length) entries.push({ lb: { algo: target.config.algorithm, hop: hopOf(e), nodeId: target.id }, rr: 0, targets });
    }
  }
  if (entries.length === 0) { await Promise.all(pools.map((p) => p.end().catch(() => undefined))); throw new ServiceError(400, 'NO_PATH', 'No path from Users through an App server to the Database'); }

  // ---- redis (validated reachable by the caller; failures mid-run degrade to misses and are counted)
  const usesCache = !!redisNode && [...instOfNode.values()].some((l) => l[0]?.redisHop);
  let redis: Redis | null = null;
  let cacheHits = 0; let cacheMisses = 0; let cacheErrors = 0;
  let intHits = 0; let intMisses = 0;
  const keyPrefix = `dsim:${plan.runId.slice(0, 8)}:`;
  if (usesCache) {
    redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000, enableOfflineQueue: false, retryStrategy: () => null });
    redis.on('error', () => undefined);
    try { await redis.connect(); } catch (e) { await Promise.all(pools.map((p) => p.end().catch(() => undefined))); throw new ServiceError(400, 'REDIS_UNREACHABLE', `Cache node is in the design but Redis is not reachable: ${(e as Error).message}`); }
  }
  const ttlS = redisNode && redisNode.type === 'redis' ? redisNode.config.ttlS : 30;

  // ---- admin connections for DB-side sampling and key loading
  const adminStatus = await adminConnect();
  const adminLocks = await adminConnect();
  const adminKeys = await adminConnect(plan.database);
  const dbSampler = new DbSampler(adminStatus);
  const closeResources = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await Promise.allSettled(pools.map((p) => p.end()));
    if (redis) {
      try {
        const keys = await redis.keys(`${keyPrefix}*`);
        if (keys.length) await redis.del(...keys);
      } catch { /* best effort */ }
      redis.disconnect();
    }
    await Promise.allSettled([adminStatus.end(), adminLocks.end(), adminKeys.end()]);
  };

  // ---- transactions
  const proxy = new RngProxy();
  const txns: TxnRt[] = [];
  const keyCache = new Map<string, Array<string | number>>();
  try {
    for (const def of design.workload.transactions) {
      if (def.weight <= 0) continue;
      const steps = new Map<string, CompiledStep[]>();
      for (const [variant, list] of Object.entries(def.variants)) steps.set(variant, list.map(compileStep));
      const paramNames = Object.keys(def.params);
      const gens: GenFn[] = [];
      for (const name of paramNames) {
        const spec = def.params[name]!;
        let keys: Array<string | number> | undefined;
        if (spec.kind === 'fromTable' || spec.kind === 'fkRef') {
          const ck = `${spec.table}.${spec.column}`;
          if (!keyCache.has(ck)) {
            try {
              const [rows] = await adminKeys.query({ sql: `SELECT \`${spec.column}\` FROM \`${spec.table}\` ORDER BY \`${spec.column}\` LIMIT 500000`, rowsAsArray: true });
              keyCache.set(ck, (rows as Array<[string | number]>).map((r) => r[0]));
            } catch (e) { throw new ServiceError(400, 'PARAM_KEYS', `Cannot load keys for parameter :${name} of ${def.name} from ${spec.table}.${spec.column}: ${(e as Error).message}`, { details: { txn: def.name } }); }
          }
          keys = keyCache.get(ck);
        }
        gens.push(makeGenerator(spec, { rng: proxy as unknown as Rng, keys }));
      }
      txns.push({ def, name: def.name, readOnly: def.readOnly, cacheable: def.cacheable, paramNames, gens, counter: 0, steps, agg: new TxnAgg() });
    }
    if (txns.length === 0) throw new ServiceError(400, 'NO_TXN', 'The workload has no transaction with weight > 0');
  } catch (e) { await closeResources(); throw e; }
  const cumWeights: number[] = []; let totalWeight = 0;
  for (const t of txns) { totalWeight += t.def.weight; cumWeights.push(totalWeight); }
  const usedVariants: Record<string, Set<string>> = {};
  for (const t of txns) usedVariants[t.name] = new Set();
  for (const list of instOfNode.values()) for (const inst of list) for (const t of txns) usedVariants[t.name]!.add(strategyFor(t.def, inst.strategy));

  const sampleRng = Rng.derive(plan.seed, 'explain');
  const sampleParams = (name: string): Params => {
    const t = txns.find((x) => x.name === name); if (!t) return {};
    proxy.cur = sampleRng;
    const out: Params = {};
    t.paramNames.forEach((p, i) => { out[p] = t.gens[i]!(t.counter + 1_000_000, {}) as never; });
    return out;
  };

  // ---- state
  const interval = new Win();
  const total = new Win();
  let measuring = false;
  let stopped = false;
  let target = 1;
  let changeP: Promise<void>; let changeR: () => void = () => undefined;
  const newChange = () => { changeP = new Promise<void>((r) => { changeR = r; }); };
  newChange();
  const errorBreakdown: Record<string, number> = {};
  let rr = 0;
  let inflightReq = 0;
  let sumRecQueue = 0; let sumRecNet = 0; let sumRecApp = 0; let sumRecPool = 0; let sumRecDb = 0; let sumN = 0;
  const lbAgg = new Map<string, { served: number }>();
  for (const e of entries) if (e.lb) lbAgg.set(e.lb.nodeId, { served: 0 });

  const hopMs = (h: Hop): number => Math.max(0, h.latencyMs + (h.jitterMs > 0 ? (rng.float() * 2 - 1) * h.jitterMs : 0));
  const wait = async (ms: number): Promise<number> => { if (ms <= 0.05) return 0; const t = hr(); await sleep(ms); return msSince(t); };

  const pickTxn = (r: Rng): TxnRt => {
    const x = r.float() * totalWeight;
    for (let i = 0; i < cumWeights.length; i++) if (x < cumWeights[i]!) return txns[i]!;
    return txns[txns.length - 1]!;
  };

  const record = (t: TxnRt, inst: Instance, rec: Rec, latency: number): void => {
    interval.hist.record(latency);
    inst.agg.win.hist.record(latency);
    if (rec.outcome === 2) { interval.errors++; inst.agg.win.errors++; } else { interval.served++; inst.agg.win.served++; }
    interval.retries += rec.retries; interval.deadlocks += rec.deadlocks; interval.lockTimeouts += rec.lockTimeouts;
    inst.agg.win.retries += rec.retries; inst.agg.win.deadlocks += rec.deadlocks;
    if (!measuring) return;
    const a = t.agg;
    a.count++; a.hist.record(latency);
    if (rec.outcome === 0) a.committed++; else if (rec.outcome === 1) a.rejected++; else a.errored++;
    a.retries += rec.retries; a.deadlocks += rec.deadlocks; a.lockTimeouts += rec.lockTimeouts;
    a.queue += rec.queue; a.net += rec.net; a.app += rec.app; a.pool += rec.pool; a.db += rec.db;
    total.hist.record(latency);
    if (rec.outcome === 2) total.errors++; else total.served++;
    total.retries += rec.retries; total.deadlocks += rec.deadlocks; total.lockTimeouts += rec.lockTimeouts;
    const na = inst.agg; na.count++; na.queueMs += rec.queue; na.poolMs += rec.pool; na.appMs += rec.app; na.netMs += rec.net;
    sumRecQueue += rec.queue; sumRecNet += rec.net; sumRecApp += rec.app; sumRecPool += rec.pool; sumRecDb += rec.db; sumN++;
    if (rec.outcome !== 0) { const k = rec.outcome === 1 ? `rejected:${rec.reason}` : `error:${rec.reason}`; errorBreakdown[k] = (errorBreakdown[k] ?? 0) + 1; }
  };

  async function dbPhase(inst: Instance, t: TxnRt, params: Params, rec: Rec, variant: string): Promise<unknown[] | null> {
    const steps = t.steps.get(variant) ?? t.steps.get('default')!;
    const iso: Isolation = variant === 'serializable' ? 'SERIALIZABLE' : sessionIso;
    const startSql = t.readOnly ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION';
    const maxRetries = inst.cfg.retry.max;
    for (let attempt = 0; ; attempt++) {
      let tp = hr();
      inst.poolWaiting++;
      let conn: PoolConnection;
      try { conn = await inst.pool.getConnection(); } catch (err) { inst.poolWaiting--; rec.pool += msSince(tp); rec.outcome = 2; rec.reason = 'connect'; void err; return null; }
      inst.poolWaiting--; inst.poolInUse++;
      rec.pool += msSince(tp);
      const threadId = (conn as unknown as { connection: { threadId: number } }).connection.threadId;
      connTxn.set(threadId, t.name);
      let destroy = false; let action: 'ok' | 'retry' | 'stop' = 'stop'; let rows: unknown[] | null = null;
      try {
        if (iso !== sessionIso) { tp = hr(); await conn.query(`SET TRANSACTION ISOLATION LEVEL ${iso}`); rec.db += msSince(tp); }
        tp = hr(); await conn.query(startSql); rec.db += msSince(tp);
        const r = await execSteps(conn as never, steps, params, { before: async () => { rec.net += await wait(hopMs(inst.dbHop) * 2); } });
        rec.db += r.dbMs; rows = r.lastRows;
        rec.net += await wait(hopMs(inst.dbHop) * 2);
        tp = hr(); await conn.query('COMMIT'); rec.db += msSince(tp);
        rec.outcome = 0; action = 'ok';
      } catch (err) {
        tp = hr();
        try { await conn.query('ROLLBACK'); } catch { destroy = true; }
        rec.db += msSince(tp);
        if (isFatal(err)) destroy = true;
        if (err instanceof TxnReject) { rec.outcome = 1; rec.reason = err.reason; }
        else if (err instanceof CasRetry) {
          if (attempt < maxRetries) { rec.retries++; action = 'retry'; } else { rec.outcome = 2; rec.reason = 'conflict'; }
        } else {
          const cls = classifyError(err);
          if (cls === 'deadlock') rec.deadlocks++;
          if (cls === 'lock_timeout') rec.lockTimeouts++;
          const act = actionFor(cls);
          if (act === 'retry' && attempt < maxRetries) { rec.retries++; action = 'retry'; }
          else if (act === 'reject') { rec.outcome = 1; rec.reason = cls; }
          else { rec.outcome = 2; rec.reason = cls === 'other' ? `other:${(err as { code?: string }).code ?? 'unknown'}` : cls; }
        }
      } finally {
        inst.poolInUse--;
        if (destroy) conn.destroy(); else conn.release();
      }
      if (action === 'ok') return rows;
      if (action === 'stop') return null;
      const b = inst.cfg.retry.backoffMs * 2 ** attempt * (0.5 + rng.float());
      rec.app += await wait(Math.min(b, 2000));
      if (stopped && plan.isCancelled()) { rec.outcome = 2; rec.reason = 'cancelled'; return null; }
    }
  }

  async function request(vu: Vu): Promise<void> {
    const t = pickTxn(vu.rng);
    proxy.cur = vu.rng;
    const params: Params = {};
    for (let i = 0; i < t.paramNames.length; i++) params[t.paramNames[i]!] = t.gens[i]!(t.counter++, {}) as never;

    const rec = new Rec();
    const t0 = hr();
    const entry = entries[rr++ % entries.length]!;
    let tgt: Target;
    if (entry.lb?.algo === 'least-connections') {
      tgt = entry.targets[0]!; let best = Infinity;
      for (const c of entry.targets) { const load = c.inst.inflight + c.inst.queue.length; if (load < best) { best = load; tgt = c; } }
    } else tgt = entry.targets[entry.rr++ % entry.targets.length]!;
    const inst = tgt.inst;
    inflightReq++;
    const fwd = (entry.lb ? hopMs(entry.lb.hop) : 0) + hopMs(tgt.hop);
    rec.net += await wait(fwd);

    let tq = hr();
    const w = inst.acquire(); if (w) await w;
    rec.queue = msSince(tq);
    const tw = hr();
    try {
      rec.app += await wait(Math.max(0, inst.cfg.processingMeanMs + (inst.cfg.processingJitterMs > 0 ? (rng.float() * 2 - 1) * inst.cfg.processingJitterMs : 0)));
      const variant = strategyFor(t.def, inst.strategy);
      let cacheKey: string | null = null;
      let served = false;
      if (redis && t.cacheable && t.readOnly && inst.redisHop) {
        cacheKey = `${keyPrefix}${t.name}:${t.paramNames.map((p) => params[p]).join('|')}`;
        rec.net += await wait(hopMs(inst.redisHop) * 2);
        tq = hr();
        try {
          const v = await redis.get(cacheKey);
          if (v !== null) { served = true; rec.cacheHit = true; cacheHits++; intHits++; } else { cacheMisses++; intMisses++; }
        } catch { cacheErrors++; cacheMisses++; intMisses++; }
        rec.net += msSince(tq);
      }
      if (!served) {
        const rows = await dbPhase(inst, t, params, rec, variant);
        if (cacheKey && rows && rec.outcome === 0 && redis) {
          void redis.set(cacheKey, JSON.stringify(rows.length > 50 ? rows.slice(0, 50) : rows), 'EX', ttlS).catch(() => undefined);
        }
      }
    } finally {
      inst.busyNs += Number(hr() - tw);
      inst.release();
    }
    rec.net += await wait((entry.lb ? hopMs(entry.lb.hop) : 0) + hopMs(tgt.hop));
    inflightReq--;
    if (entry.lb && measuring) lbAgg.get(entry.lb.nodeId)!.served++;
    record(t, inst, rec, msSince(t0));
  }

  const thinkMs = (r: Rng): number => {
    const lo = users.thinkMinMs; const hi = Math.max(lo, users.thinkMaxMs);
    if (users.thinkDist === 'fixed') return lo;
    if (users.thinkDist === 'exponential') return Math.min(r.exponential((lo + hi) / 2), 10 * (hi || 1));
    return lo + r.float() * (hi - lo);
  };

  async function vuLoop(vu: Vu): Promise<void> {
    while (!stopped) {
      if (vu.id >= target) { await changeP; continue; }
      if (!vu.started) { vu.started = true; await sleep(vu.rng.float() * Math.max(20, users.thinkMaxMs)); if (stopped) break; }
      try { await request(vu); } catch { /* request() records its own outcomes; anything escaping is an engine fault, not a workload result */ }
      if (stopped) break;
      const th = thinkMs(vu.rng);
      if (th > 0.05) await sleep(th);
    }
  }

  // ---- lock sampler (<= 2 Hz)
  const lockRows: LockWaitRow[] = []; const lockAggMap = new Map<string, LockAgg>();
  let lockSnapshots = 0; let lockSnapshotsWithWaits = 0; let lockSeq = 0; let lastLockKeys = new Set<string>();
  let measureStartHr = 0n;
  let lockBusy = false;
  const lockTimer = setInterval(() => {
    if (lockBusy || stopped) return;
    lockBusy = true;
    (async () => {
      const [rows] = await adminLocks.query(LOCK_SQL, [plan.database]);
      const list = rows as Array<{ waiting_conn: number | null; blocking_conn: number | null; tbl: string; idx: string | null; mode: string; data: string | null }>;
      if (measuring) lockSnapshots++;
      const edges = new Map<string, RunLocksEvent['edges'][number]>();
      const keys = new Set<string>();
      for (const r of list) {
        const waiting = connTxn.get(Number(r.waiting_conn)) ?? 'unknown';
        const blocking = connTxn.get(Number(r.blocking_conn)) ?? 'unknown';
        edges.set(`${waiting}|${blocking}|${r.tbl}|${r.mode}`, { waiting, blocking, table: r.tbl, mode: r.mode });
        if (!measuring) continue;
        const key = `${waiting}|${blocking}|${r.tbl}|${r.data ?? ''}`;
        keys.add(key);
        const ak = `${r.tbl}|${r.idx ?? ''}|${r.data ?? ''}`;
        let a = lockAggMap.get(ak);
        if (!a) { a = { table: r.tbl, indexName: r.idx, lockMode: r.mode, lockData: r.data, count: 0, waitingTxns: {}, blockingTxns: {} }; lockAggMap.set(ak, a); }
        a.count++; a.waitingTxns[waiting] = (a.waitingTxns[waiting] ?? 0) + 1; a.blockingTxns[blocking] = (a.blockingTxns[blocking] ?? 0) + 1;
        if (!lastLockKeys.has(key) && lockRows.length < MAX_LOCK_ROWS) {
          lockRows.push({ seq: lockSeq++, atMs: Math.round(msSince(measureStartHr)), waitingTxn: waiting, blockingTxn: blocking, tableName: r.tbl, indexName: r.idx, lockMode: r.mode, lockData: r.data });
        }
      }
      if (measuring) { if (list.length) lockSnapshotsWithWaits++; lastLockKeys = keys; }
      plan.emit(SOCKET_EVENTS.locks, { runId: plan.runId, edges: [...edges.values()] } satisfies RunLocksEvent);
    })().catch(() => undefined).finally(() => { lockBusy = false; });
  }, 500);

  // ---- main loop
  const emitStatus = (status: RunStatusEvent['status'], phase: string, elapsedS: number, totalS: number) =>
    plan.emit(SOCKET_EVENTS.status, { runId: plan.runId, status, phase, elapsedS, totalS, step: plan.step } satisfies RunStatusEvent);
  const samples: RunSample[] = [];
  const poolMaxOf = (l: Instance[]) => l.reduce((s, i) => s + i.cfg.poolSize, 0);
  let poolInUseSum = 0; let poolInUseN = 0;
  let measuredEndHr = 0n;
  const startMeasure = async () => {
    if (plan.onMeasureStart) await plan.onMeasureStart().catch(() => undefined);
    total.reset(); for (const t of txns) t.agg = new TxnAgg();
    for (const a of nodeAggs.values()) { a.count = 0; a.queueMs = 0; a.poolMs = 0; a.appMs = 0; a.netMs = 0; a.busyAtStart = a.instances.reduce((s, i) => s + i.busyNs, 0); }
    sumRecQueue = sumRecNet = sumRecApp = sumRecPool = sumRecDb = 0; sumN = 0;
    cacheHits = cacheMisses = cacheErrors = 0;
    measureStartHr = hr(); dbSampler.measuring = true; measuring = true;
  };

  const vus: Vu[] = Array.from({ length: plan.vus }, (_, id) => ({ id, rng: Rng.derive(plan.seed, 'vu', id), started: false }));
  let cancelled = false;
  const loopStart = hr();
  const sampleOffset = plan.sampleOffsetS ?? 0;
  try {
    await dbSampler.poll();
    target = targetVus(plan.pattern, plan.vus, 0, plan.warmupS, plan.durationS);
    if (plan.warmupS === 0) await startMeasure();
    const vuPromises = vus.map((v) => vuLoop(v));
    const SUB = 250;
    const totalS = plan.warmupS + plan.durationS;
    for (let k = 1; ; k++) {
      const due = k * SUB;
      const remaining = due - msSince(loopStart);
      if (remaining > 0) await sleep(remaining);
      const elapsedS = due / 1000;
      if (plan.isCancelled()) { cancelled = true; break; }
      target = targetVus(plan.pattern, plan.vus, elapsedS, plan.warmupS, plan.durationS);
      const prevChange = changeR; newChange(); prevChange();
      if (k % 4 !== 0) continue;

      // ---- 1 Hz sample
      const sec = k / 4;
      await Promise.race([dbSampler.poll(), sleep(600)]);
      const dbs = dbSampler.take();
      const tS = sec - plan.warmupS;
      let queue = 0; let waiting = 0; let inUseNow = 0;
      for (const list of instOfNode.values()) for (const i of list) { queue += i.queue.length; waiting += i.poolWaiting; inUseNow += i.poolInUse; }
      if (measuring) { poolInUseSum += inUseNow; poolInUseN++; }
      const lookups = intHits + intMisses;
      const cacheRatio = lookups > 0 ? intHits / lookups : null;
      const nodes: Record<string, Record<string, number>> = {};
      nodes[usersNode.id] = { vus: target, tps: interval.served, p95: round(interval.hist.percentile(0.95), 1), inflight: inflightReq };
      for (const [id, a] of nodeAggs) {
        const list = a.instances;
        nodes[id] = {
          tps: a.win.served, p95: round(a.win.hist.percentile(0.95), 1), queue: list.reduce((s, i) => s + i.queue.length, 0),
          workers: list.reduce((s, i) => s + i.inflight, 0), workersMax: list.reduce((s, i) => s + i.cfg.workers, 0),
          pool: list.reduce((s, i) => s + i.poolInUse, 0), poolMax: poolMaxOf(list), poolWaiting: list.reduce((s, i) => s + i.poolWaiting, 0),
        };
      }
      for (const [id, l] of lbAgg) nodes[id] = { tps: interval.served, inflight: inflightReq, served: l.served };
      if (redisNode && redis) nodes[redisNode.id] = { ops: lookups, ...(cacheRatio !== null ? { hit: round(cacheRatio, 3) } : {}) };
      nodes[mysqlNode.id] = { tps: interval.served, threads: dbs.threadsRunning, lockWaits: dbs.rowLockWaits, ...(dbs.bpHitRatio !== null ? { bp: round(dbs.bpHitRatio, 4) } : {}) };
      const sample: RunSample = {
        tS: tS + sampleOffset, tps: interval.served, p50Ms: round(interval.hist.percentile(0.5)), p95Ms: round(interval.hist.percentile(0.95)), p99Ms: round(interval.hist.percentile(0.99)),
        errors: interval.errors, activeVus: Math.min(target, plan.vus), appQueue: queue, poolWaiting: waiting,
        threadsRunning: dbs.threadsRunning, rowLockWaits: dbs.rowLockWaits, lockWaitMs: dbs.lockWaitMs, bpHitRatio: dbs.bpHitRatio, cacheHitRatio: cacheRatio,
        retries: interval.retries, deadlocks: interval.deadlocks, nodes,
      };
      if (measuring && tS >= 1) { const { nodes: _n, ...stored } = sample; void _n; samples.push(stored); }
      plan.emit(SOCKET_EVENTS.sample, { runId: plan.runId, sample } satisfies RunSampleEvent);
      emitStatus(measuring ? 'RUNNING' : 'WARMING', measuring ? 'Measuring' : 'Warm-up', measuring ? Math.max(0, tS) : sec, measuring ? plan.durationS : plan.warmupS);
      interval.reset(); intHits = 0; intMisses = 0; for (const a of nodeAggs.values()) a.win.reset();

      if (!measuring && sec >= plan.warmupS) await startMeasure();
      else if (measuring && sec >= totalS) { measuredEndHr = hr(); break; }
    }
    if (!measuredEndHr) measuredEndHr = hr();
    measuring = false; dbSampler.measuring = false;
    stopped = true; changeR();
    // drain in-flight requests (bounded by lock-wait timeout x retries; capped)
    await Promise.race([Promise.allSettled(vuPromises), sleep(Math.max(3000, mysqlCfg.lockWaitTimeoutS * 1000 * 2 + 1000))]);
  } finally {
    stopped = true; changeR(); clearInterval(lockTimer);
    await closeResources();
  }

  // ---- results
  const measuredS = Math.max(0.001, Number((measuredEndHr || hr()) - (measureStartHr || loopStart)) / 1e9);
  const mean = (n: number, d: number) => (d > 0 ? n / d : 0);
  const txnStats: TxnStat[] = txns.map((t) => {
    const a = t.agg; const n = a.count;
    return {
      txnName: t.name, count: n, committed: a.committed, rejected: a.rejected, errored: a.errored, retries: a.retries, deadlocks: a.deadlocks,
      p50Ms: round(a.hist.percentile(0.5)), p95Ms: round(a.hist.percentile(0.95)), p99Ms: round(a.hist.percentile(0.99)), meanMs: round(a.hist.mean()),
      queueMs: round(mean(a.queue, n), 3), netMs: round(mean(a.net, n), 3), appMs: round(mean(a.app, n), 3), poolMs: round(mean(a.pool, n), 3), dbMs: round(mean(a.db, n), 3),
    };
  });
  const sum = (f: (t: TxnStat) => number) => txnStats.reduce((s, t) => s + f(t), 0);
  const count = sum((t) => t.count);
  const nodeSummaries: NodeSummary[] = [...nodeAggs.values()].map((a) => {
    const workers = a.instances.reduce((s, i) => s + i.cfg.workers, 0);
    const busy = a.instances.reduce((s, i) => s + i.busyNs, 0) - a.busyAtStart;
    return {
      nodeId: a.nodeId, count: a.count, queueMs: mean(a.queueMs, a.count), poolMs: mean(a.poolMs, a.count), appMs: mean(a.appMs, a.count), netMs: mean(a.netMs, a.count),
      workerUtil: clamp(busy / (workers * measuredS * 1e9), 0, 1), poolUtil: 0,
      workers, poolMax: poolMaxOf(a.instances), instances: a.instances.length,
    };
  });
  // Pool utilisation is tracked globally per tick; scale it by each node's share of the pool capacity.
  const totalPoolMax = nodeSummaries.reduce((s, n) => s + n.poolMax, 0);
  for (const n of nodeSummaries) n.poolUtil = poolInUseN && totalPoolMax ? clamp(poolInUseSum / poolInUseN / totalPoolMax, 0, 1) : 0;
  const lookups = cacheHits + cacheMisses;
  const first = [...instOfNode.values()][0]?.[0];
  return {
    samples, txnStats,
    totals: {
      count, committed: sum((t) => t.committed), rejected: sum((t) => t.rejected), errored: sum((t) => t.errored), retries: sum((t) => t.retries), deadlocks: sum((t) => t.deadlocks), lockTimeouts: total.lockTimeouts,
      tpsAvg: round(total.served / measuredS), p50Ms: round(total.hist.percentile(0.5)), p95Ms: round(total.hist.percentile(0.95)), p99Ms: round(total.hist.percentile(0.99)), meanMs: round(total.hist.mean()),
    },
    nodes: nodeSummaries,
    phases: { queueMs: mean(sumRecQueue, sumN), netMs: mean(sumRecNet, sumN), appMs: mean(sumRecApp, sumN), poolMs: mean(sumRecPool, sumN), dbMs: mean(sumRecDb, sumN) },
    db: { threadsAvg: mean(dbSampler.totals.threadSum, dbSampler.totals.threadN), threadsMax: dbSampler.totals.threadMax, rowLockWaits: dbSampler.totals.lockWaits, rowLockTimeMs: dbSampler.totals.lockMs, bpRequests: dbSampler.totals.bpReq, bpReads: dbSampler.totals.bpReads, comSelect: dbSampler.totals.comSelect, comWrite: dbSampler.totals.comWrite },
    cache: { present: usesCache, hits: cacheHits, misses: cacheMisses, errors: cacheErrors, ratio: lookups > 0 ? cacheHits / lookups : null },
    lockWaits: lockRows, lockAgg: [...lockAggMap.values()].sort((a, b) => b.count - a.count), lockSnapshots, lockSnapshotsWithWaits,
    errorBreakdown, measuredS, cancelled,
    usedVariants: Object.fromEntries(Object.entries(usedVariants).map(([k, v]) => [k, [...v]])),
    sampleParams,
    topology: {
      appNodeIds: [...nodeAggs.keys()], mysqlNodeId: mysqlNode.id, redisNodeId: redisNode?.id ?? null, usersNodeId: usersNode.id, lbNodeId: lbNode?.id ?? null,
      totalPool: totalPoolMax, poolPerInstance: first?.cfg.poolSize ?? 0, instances: [...instOfNode.values()].reduce((s, l) => s + l.length, 0),
    },
  };
}
