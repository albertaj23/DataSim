// Pure analysis tests (bottleneck, SLO verdict, advisor fixes) on synthetic LoadResults: no database needed.
import { describe, expect, it } from 'vitest';
import type { DesignDoc, InvariantResult } from '@datasim/shared';
import { buildFindings, detectBottleneck, sloVerdict } from '../../src/engine/analysis.js';
import type { LoadResult } from '../../src/engine/load.js';
import { miniDesign } from './helpers.js';

const design = (slo = 200): DesignDoc => ({ ...miniDesign({ app: { poolSize: 16 } }), slo: { p95Ms: slo, maxErrorPct: 1, perTxn: {} } });

interface Over { mean?: number; p95?: number; queue?: number; pool?: number; dbMs?: number; poolUtil?: number; workerUtil?: number; threads?: number; lockMsPerReq?: number; count?: number; netMs?: number }
function load(o: Over = {}): LoadResult {
  const count = o.count ?? 10_000;
  const queue = o.queue ?? 0; const pool = o.pool ?? 0; const dbMs = o.dbMs ?? 10; const net = o.netMs ?? 5;
  return {
    samples: [], txnStats: [], lockWaits: [], lockAgg: [], lockSnapshots: 0, lockSnapshotsWithWaits: 0, errorBreakdown: {}, measuredS: 10, cancelled: false, usedVariants: {}, sampleParams: () => ({}),
    totals: { count, committed: count, rejected: 0, errored: 0, retries: 0, deadlocks: 0, lockTimeouts: 0, tpsAvg: count / 10, p50Ms: 10, p95Ms: o.p95 ?? 40, p99Ms: 60, meanMs: o.mean ?? queue + pool + dbMs + net },
    nodes: [{ nodeId: 'a', count, queueMs: queue, poolMs: pool, appMs: 1, netMs: net, workerUtil: o.workerUtil ?? 0.3, poolUtil: o.poolUtil ?? 0.3, workers: 64, poolMax: 16, instances: 1 }],
    phases: { queueMs: queue, netMs: net, appMs: 1, poolMs: pool, dbMs },
    db: { threadsAvg: o.threads ?? 4, threadsMax: 10, rowLockWaits: o.lockMsPerReq ? 400 : 0, rowLockTimeMs: (o.lockMsPerReq ?? 0) * count, bpRequests: 1, bpReads: 0, comSelect: 1, comWrite: 1 },
    cache: { present: false, hits: 0, misses: 0, errors: 0, ratio: null },
    topology: { appNodeIds: ['a'], mysqlNodeId: 'd', redisNodeId: null, usersNodeId: 'u', lbNodeId: null, totalPool: 16, poolPerInstance: 16, instances: 1 },
  };
}

describe('detectBottleneck', () => {
  it('stays null for a healthy run (p95 << SLO, tiny queue/pool waits)', () => {
    expect(detectBottleneck(design(), load({ queue: 0.1, pool: 1.8, dbMs: 14.8, netMs: 15, lockMsPerReq: 0.8, threads: 8 }))).toBeNull();
  });

  it('flags the worker queue when it dominates a naive load run (the T1 150 VU shape)', () => {
    // mean 90 ms: queue 21.6 (24%), pool 19.2 (21%), db 27.7, lock waits 12 ms per request (13%)
    const b = detectBottleneck(design(200), load({ mean: 90.3, p95: 282, queue: 21.6, pool: 19.2, dbMs: 27.7, netMs: 19.2, lockMsPerReq: 12.2, poolUtil: 0.56, workerUtil: 0.44, threads: 6 }));
    expect(b).toMatchObject({ kind: 'app', severity: 'warning', nodeId: 'a' });
    expect(b!.reason).toContain('worker queue');
  });

  it('flags a saturated pool by its wait share', () => {
    const b = detectBottleneck(design(), load({ queue: 2, pool: 30, dbMs: 12, poolUtil: 0.97 }));
    expect(b).toMatchObject({ kind: 'pool', nodeId: 'a' });
    expect(b!.reason).toContain('97% in use');
  });

  it('prefers the database when lock waits are within a quarter of the top queue/pool share (ties favour db)', () => {
    const b = detectBottleneck(design(), load({ mean: 100, queue: 24, pool: 8, dbMs: 40, lockMsPerReq: 20 }));
    expect(b).toMatchObject({ kind: 'db', nodeId: 'd' });
    expect(b!.reason).toContain('row-lock waits');
  });

  it('names the largest contributor with a lower bar once the SLO is breached, and is critical past 45%', () => {
    const b = detectBottleneck(design(100), load({ mean: 100, p95: 180, queue: 14, pool: 5, dbMs: 40 }));
    expect(b).toMatchObject({ kind: 'app', severity: 'warning' });
    expect(detectBottleneck(design(), load({ queue: 80, dbMs: 10 }))).toMatchObject({ kind: 'app', severity: 'critical' });
  });

  it('reports a database saturated by running threads', () => {
    const b = detectBottleneck(design(), load({ queue: 0, pool: 1, dbMs: 60, netMs: 6, threads: 14 }));
    expect(b).toMatchObject({ kind: 'db' });
    expect(b!.reason).toContain('threads running');
  });
});

describe('sloVerdict with invariants', () => {
  const tot = { totals: { p95Ms: 40, count: 1000, errored: 0 }, txnStats: [] };
  const inv = (violations: number): InvariantResult => ({ name: 'no_overbooking', sql: 'SELECT 0', violations, passed: violations === 0 });

  it('fails when an invariant has violations, listing it first before the p95 reason', () => {
    const v = sloVerdict(design(10), { ...tot, totals: { ...tot.totals, p95Ms: 40 } }, [inv(3)]);
    expect(v.pass).toBe(false);
    expect(v.reasons[0]).toBe('Invariant no_overbooking violated (3 violations)');
    expect(v.reasons[1]).toContain('p95 40 ms exceeds');
  });
  it('passes when latency is fine and invariants hold, and ignores evaluation errors with zero violations', () => {
    expect(sloVerdict(design(), tot, [inv(0)]).pass).toBe(true);
    expect(sloVerdict(design(), tot, [{ ...inv(0), passed: false, error: 'boom' }]).pass).toBe(true);
    expect(sloVerdict(design(), tot).pass).toBe(true);
  });
});

describe('advisor fixes', () => {
  const find = (d: DesignDoc, strategy: string, l: LoadResult, kind: string) => buildFindings({ design: d, strategy, isolation: 'REPEATABLE READ', load: l, invariants: [], explained: [], statements: [], slo: { pass: true, reasons: [] } }).find((f) => f.kind === kind);

  it('POOL_STARVATION proposes no pool fix when lock waits dominate, and says why', () => {
    const f = find(design(), 'naive', load({ mean: 90, queue: 10, pool: 20, dbMs: 40, lockMsPerReq: 16, poolUtil: 1 }), 'POOL_STARVATION')!;
    expect(f).toBeDefined();
    expect(f.fix).toBeNull();
    expect(f.explanation).toContain('only move the queue into InnoDB');
  });
  it('POOL_STARVATION still proposes a bigger pool when the wait is pure pool starvation', () => {
    const f = find(design(), 'naive', load({ mean: 60, queue: 5, pool: 25, dbMs: 12, lockMsPerReq: 1, poolUtil: 1 }), 'POOL_STARVATION')!;
    expect(f.fix).toEqual({ type: 'SET_POOL', poolSize: 32 });
  });

  const hot = (l: LoadResult): LoadResult => ({
    ...l, lockSnapshotsWithWaits: 5, lockAgg: [{ table: 'seat_section', indexName: 'PRIMARY', lockMode: 'X,REC_NOT_GAP', lockData: '1', count: 40, waitingTxns: { register: 40 }, blockingTxns: { register: 40 } }],
    db: { ...l.db, rowLockWaits: 400 },
  });
  it('HOT_ROW proposes atomic only when the waiting transaction still runs the naive flow', () => {
    const f = find(design(), 'naive', hot(load({ lockMsPerReq: 8 })), 'HOT_ROW')!;
    expect(f.fix).toEqual({ type: 'SET_STRATEGY', strategy: 'atomic' });
  });
  it('HOT_ROW never proposes switching away from atomic, and recommends structural options instead', () => {
    const f = find(design(), 'atomic', hot(load({ lockMsPerReq: 8 })), 'HOT_ROW')!;
    expect(f.fix).toBeNull();
    expect(f.explanation).toContain('shard the hot counter');
    expect(f.explanation).not.toContain('(atomic UPDATE)');
  });
});
