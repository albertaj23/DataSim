// Run orchestration: global lock, provisioning, load, analysis, persistence, capacity steps, strategy comparison.
import { randomUUID } from 'node:crypto';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { SOCKET_EVENTS, STRATEGY_VARIANTS, fitUsl, hasErrors, validateDesign } from '@datasim/shared';
import type {
  CapacityPoint, DesignDoc, Finding, InvariantResult, RunKind, RunOverrides, RunStatusEvent, RunSummary, StatementStat, StrategyVariant, UsersConfig,
} from '@datasim/shared';
import { appPool } from '../db/pool.js';
import { emitRun } from '../realtime/runEmitter.js';
import { ServiceError } from '../services/liveStrategy.js';
import { getActiveRunId, setActiveRunId } from './active.js';
import { adminConnect, mysqlVersion, sandboxName } from './admin.js';
import {
  DigestTracker, buildFindings, buildStatementStats, checkInvariants, detectBottleneck, explainStatements, sloVerdict,
} from './analysis.js';
import { analyzeSteps, capacitySentence, littlesLaw } from './capacity.js';
import { pingRedis, runLoad } from './load.js';
import type { LoadResult } from './load.js';
import { ProvisionCancelled, provision, totalSeedRows } from './provision.js';
import { createRunRow, failRun, failStaleRuns, loadSummary, persistFinal, setRunStatus } from './store.js';
import type { FinalRun } from './store.js';
import { round } from './util.js';

export const RUN_LOCK = 'datasim_run';

export interface StartRunArgs {
  projectId: string; revisionNo: number; design: DesignDoc; kind: 'LOAD' | 'CAPACITY'; overrides: RunOverrides;
  parentRunId?: string; kindOverride?: 'STRATEGY_CHILD';
}

interface Resolved {
  design: DesignDoc; strategy: string; isolation: string; vus: number; durationS: number; warmupS: number; seed: number; rowScale: number; pattern: UsersConfig['pattern'];
}

interface RunCtx {
  runId: string; projectId: string; revisionNo: number; kind: RunKind; parentRunId: string | null; database: string;
  design: DesignDoc; overrides: RunOverrides; strategyOverride?: StrategyVariant; resolved: Resolved; cancelled: boolean;
}
const live = new Map<string, RunCtx>();

/** Applies overrides to a clone of the design and derives the effective run parameters. */
export function resolveRun(design: DesignDoc, o: RunOverrides): Resolved {
  const d = structuredClone(design);
  const users = d.nodes.find((n) => n.type === 'users');
  const mysql = d.nodes.find((n) => n.type === 'mysql');
  const apps = d.nodes.flatMap((n) => (n.type === 'app' ? [n] : []));
  if (users?.type === 'users') {
    if (o.vus !== undefined) users.config.vus = o.vus;
    if (o.durationS !== undefined) users.config.durationS = o.durationS;
    if (o.warmupS !== undefined) users.config.warmupS = o.warmupS;
  }
  if (mysql?.type === 'mysql' && o.isolation) mysql.config.isolation = o.isolation;
  if (o.strategy) apps.forEach((a) => { a.config.strategy = o.strategy!; });
  if (o.seed !== undefined) d.seed = o.seed;
  const strategies = new Set(apps.map((a) => a.config.strategy));
  return {
    design: d, strategy: strategies.size > 1 ? 'mixed' : ([...strategies][0] ?? 'default'),
    isolation: mysql?.type === 'mysql' ? mysql.config.isolation : 'REPEATABLE READ',
    vus: users?.type === 'users' ? users.config.vus : 1, durationS: users?.type === 'users' ? users.config.durationS : 10,
    warmupS: users?.type === 'users' ? users.config.warmupS : 3, seed: d.seed, rowScale: o.rowScale ?? 1,
    pattern: users?.type === 'users' ? users.config.pattern : 'constant',
  };
}

// ---------------------------------------------------------------- global lock
async function acquireGlobalLock(runId: string): Promise<() => Promise<void>> {
  const busy = () => new ServiceError(409, 'RUN_ACTIVE', 'Another run is in progress. Wait for it to finish or cancel it, then start this one again.', { activeRunId: getActiveRunId() });
  if (getActiveRunId()) throw busy();
  setActiveRunId(runId); // reserve synchronously so two requests cannot both pass the check
  let conn;
  try {
    conn = await appPool.getConnection();
    const [rows] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS got', [RUN_LOCK]);
    if (rows[0]?.got !== 1) throw busy();
  } catch (err) {
    conn?.release();
    setActiveRunId(null);
    throw err;
  }
  const held = conn;
  return async () => {
    await held.query('SELECT RELEASE_LOCK(?)', [RUN_LOCK]).catch(() => undefined);
    held.release();
    setActiveRunId(null);
  };
}

/** At startup: runs left non-terminal by a previous server process are marked FAILED (unless a live run holds the lock). */
export async function recoverStaleRuns(): Promise<number> {
  if (getActiveRunId()) return 0;
  const conn = await appPool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS got', [RUN_LOCK]);
    if (rows[0]?.got !== 1) return 0;
    try { return await failStaleRuns(); } finally { await conn.query('SELECT RELEASE_LOCK(?)', [RUN_LOCK]).catch(() => undefined); }
  } finally { conn.release(); }
}

// ---------------------------------------------------------------- validation (fast fail before a run row exists)
async function validateForRun(design: DesignDoc): Promise<void> {
  const problems = validateDesign(design);
  if (hasErrors(problems)) {
    const errs = problems.filter((p) => p.severity === 'error');
    throw new ServiceError(400, 'INVALID_DESIGN', `The design has ${errs.length} problem${errs.length === 1 ? '' : 's'}: ${errs.slice(0, 3).map((p) => p.message).join('; ')}`, { problems });
  }
  const redisNode = design.nodes.find((n) => n.type === 'redis');
  if (redisNode && design.edges.some((e) => e.target === redisNode.id)) {
    const err = await pingRedis();
    if (err) throw new ServiceError(400, 'REDIS_UNREACHABLE', `The design has a Cache node but Redis is not reachable (${err}). Start Redis (npm run db:up) or remove the Cache node; results are never silently emulated.`);
  }
}

const emitStatus = (runId: string, status: RunStatusEvent['status'], phase: string, extra: Partial<RunStatusEvent> = {}) => emitRun(runId, SOCKET_EVENTS.status, { runId, status, phase, ...extra } satisfies RunStatusEvent);

// ---------------------------------------------------------------- analysis (shared by load and capacity steps)
interface Analysis {
  invariants: InvariantResult[]; statements: StatementStat[]; findings: Finding[];
  slo: ReturnType<typeof sloVerdict>; bottleneck: ReturnType<typeof detectBottleneck>;
}
async function analyze(ctx: RunCtx, load: LoadResult, admin: Connection, digests: DigestTracker): Promise<Analysis> {
  const design = ctx.resolved.design;
  const digestRows = await digests.collect(); // before our own EXPLAIN / invariant statements add digests
  const invariants = await checkInvariants(admin, design);
  const explained = await explainStatements(admin, design, load);
  const statements = buildStatementStats(digestRows, explained);
  const slo = sloVerdict(design, load);
  const findings = buildFindings({ design, strategy: ctx.resolved.strategy, isolation: ctx.resolved.isolation, load, invariants, explained, statements, slo });
  return { invariants, statements, findings, slo, bottleneck: detectBottleneck(design, load) };
}

function loadSettings(ctx: RunCtx, load: LoadResult, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const r = ctx.resolved;
  const users = r.design.nodes.find((n) => n.type === 'users');
  return {
    kind: ctx.kind, strategy: r.strategy, isolation: r.isolation, vus: r.vus, durationS: r.durationS, warmupS: r.warmupS, seed: r.seed, rowScale: r.rowScale,
    pattern: users?.type === 'users' ? users.config.pattern : 'constant', overrides: ctx.overrides,
    tpsDefinition: 'committed + rejected responses per second (errors excluded)',
    measuredS: round(load.measuredS, 2), phases: load.phases, nodes: load.nodes, db: load.db, cache: load.cache, errorBreakdown: load.errorBreakdown,
    lockSnapshots: load.lockSnapshots, lockSnapshotsWithWaits: load.lockSnapshotsWithWaits, usedVariants: load.usedVariants, topology: load.topology,
    ...extra,
  };
}

const totalsOf = (l: LoadResult) => ({ count: l.totals.count, committed: l.totals.committed, rejected: l.totals.rejected, errored: l.totals.errored, retries: l.totals.retries, deadlocks: l.totals.deadlocks, lockTimeouts: l.totals.lockTimeouts, tpsAvg: l.totals.tpsAvg, p50Ms: l.totals.p50Ms, p95Ms: l.totals.p95Ms, p99Ms: l.totals.p99Ms });

// ---------------------------------------------------------------- pipelines
async function executeLoad(ctx: RunCtx): Promise<void> {
  const r = ctx.resolved;
  const emit = (event: string, payload: unknown) => emitRun(ctx.runId, event, payload);
  emitStatus(ctx.runId, 'PROVISIONING', 'Provisioning sandbox');
  await setRunStatus(ctx.runId, 'PROVISIONING', { startedAt: true, mysqlVersion: await mysqlVersion() });
  const prov = await provision(ctx.projectId, r.design, {
    rowScale: r.rowScale, seed: r.seed, runId: ctx.runId, isCancelled: () => ctx.cancelled,
    onProgress: (e) => emit(SOCKET_EVENTS.progress, { ...e, runId: ctx.runId }),
  });
  if (ctx.cancelled) throw new ProvisionCancelled();

  const admin = await adminConnect(ctx.database);
  try {
    const digests = new DigestTracker(admin, ctx.database);
    emitStatus(ctx.runId, 'WARMING', 'Warm-up', { elapsedS: 0, totalS: r.warmupS });
    await setRunStatus(ctx.runId, 'WARMING');
    const load = await runLoad({
      runId: ctx.runId, design: r.design, database: ctx.database, vus: r.vus, pattern: r.pattern, durationS: r.durationS, warmupS: r.warmupS,
      strategy: ctx.strategyOverride, isolation: r.isolation as never, seed: r.seed, emit, isCancelled: () => ctx.cancelled,
      onMeasureStart: async () => { await digests.start(); void setRunStatus(ctx.runId, 'RUNNING'); },
    });
    const settings = loadSettings(ctx, load, { provision: { rows: prov.rows, tables: prov.tables, ms: prov.ms } });
    if (ctx.cancelled || load.cancelled) {
      await persistFinal({ runId: ctx.runId, settings, totals: totalsOf(load), cacheHitRatio: load.cache.ratio, slo: null, bottleneck: null, samples: load.samples, txnStats: load.txnStats, statements: [], lockWaits: load.lockWaits, invariants: [], findings: [], status: 'CANCELLED' });
      return;
    }
    emitStatus(ctx.runId, 'ANALYZING', 'Analyzing');
    await setRunStatus(ctx.runId, 'ANALYZING');
    const a = await analyze(ctx, load, admin, digests);
    await persistFinal({
      runId: ctx.runId, settings, totals: totalsOf(load), cacheHitRatio: load.cache.ratio, slo: a.slo, bottleneck: a.bottleneck, samples: load.samples, txnStats: load.txnStats,
      statements: a.statements, lockWaits: load.lockWaits, invariants: a.invariants, findings: a.findings, status: 'COMPLETED',
    });
  } finally { await admin.end().catch(() => undefined); }
}

async function executeCapacity(ctx: RunCtx): Promise<void> {
  const r = ctx.resolved; const design = r.design;
  const emit = (event: string, payload: unknown) => emitRun(ctx.runId, event, payload);
  const steps = ctx.overrides.capacitySteps ?? design.capacity.steps;
  const stepDur = ctx.overrides.capacityStepDurationS ?? design.capacity.stepDurationS;
  const warm = ctx.overrides.warmupS ?? Math.min(2, r.warmupS);
  const writes = design.workload.transactions.some((t) => !t.readOnly && t.weight > 0);
  // Re-provision before every step when the workload writes and seeding is cheap: otherwise later steps would run against
  // state (full sections, grown tables) that earlier steps created, and the curve would not compare like with like.
  const reprovision = writes && totalSeedRows(design, r.rowScale) <= 30_000;
  emitStatus(ctx.runId, 'PROVISIONING', 'Provisioning sandbox');
  await setRunStatus(ctx.runId, 'PROVISIONING', { startedAt: true, mysqlVersion: await mysqlVersion() });

  const perStep: Array<{ vus: number; load: LoadResult; analysis: Analysis; point: CapacityPoint }> = [];
  let offset = 0; let provInfo = { rows: 0, tables: 0, ms: 0 };
  for (let i = 0; i < steps.length; i++) {
    if (ctx.cancelled) throw new ProvisionCancelled();
    const vus = steps[i]!;
    if (i === 0 || reprovision) {
      emitStatus(ctx.runId, 'PROVISIONING', 'Provisioning sandbox', { step: { n: i + 1, of: steps.length, vus } });
      provInfo = await provision(ctx.projectId, design, { rowScale: r.rowScale, seed: r.seed, runId: ctx.runId, isCancelled: () => ctx.cancelled, onProgress: (e) => emit(SOCKET_EVENTS.progress, { ...e, runId: ctx.runId }) });
    }
    const admin = await adminConnect(ctx.database);
    try {
      const digests = new DigestTracker(admin, ctx.database);
      await setRunStatus(ctx.runId, 'RUNNING');
      const load = await runLoad({
        runId: ctx.runId, design, database: ctx.database, vus, pattern: 'constant', durationS: stepDur, warmupS: warm, strategy: ctx.strategyOverride, isolation: r.isolation as never, seed: r.seed,
        sampleOffsetS: offset, step: { n: i + 1, of: steps.length, vus }, emit, isCancelled: () => ctx.cancelled, onMeasureStart: async () => { await digests.start(); },
      });
      if (load.cancelled || ctx.cancelled) throw new ProvisionCancelled();
      emitStatus(ctx.runId, 'ANALYZING', 'Analyzing step', { step: { n: i + 1, of: steps.length, vus } });
      const analysis = await analyze(ctx, load, admin, digests);
      const t = load.totals;
      perStep.push({ vus, load, analysis, point: { stepNo: i + 1, vus, tps: t.tpsAvg, p50Ms: t.p50Ms, p95Ms: t.p95Ms, errorRate: t.count ? round(t.errored / t.count, 5) : 0, runId: ctx.runId } });
      offset += Math.round(load.measuredS);
    } finally { await admin.end().catch(() => undefined); }
  }

  const points = perStep.map((s) => s.point);
  const slo = design.slo;
  const lim = { p95Ms: slo.p95Ms, maxErrorPct: slo.maxErrorPct };
  const { kneeVus, sustainedVus, sloBrokenAt } = analyzeSteps(points, lim);
  const fit = fitUsl(points.map((p) => ({ n: p.vus, x: p.tps })));
  const sentence = capacitySentence(points, fit, lim, { kneeVus, sustainedVus });
  const users = design.nodes.find((n) => n.type === 'users');
  const thinkMean = users?.type === 'users' ? (users.config.thinkDist === 'fixed' ? users.config.thinkMinMs : (users.config.thinkMinMs + users.config.thinkMaxMs) / 2) : 0;
  const little = littlesLaw(points, perStep.map((s) => s.load.totals.meanMs), thinkMean);

  const ref = perStep.find((s) => s.vus === sustainedVus) ?? perStep[0]!;
  const reasons: string[] = [];
  if (sloBrokenAt !== null) { const p = points.find((x) => x.vus === sloBrokenAt)!; reasons.push(`SLO breaks at ${sloBrokenAt} VUs (p95 ${Math.round(p.p95Ms)} ms, error rate ${round(p.errorRate * 100, 2)}%)`); }
  else if (kneeVus !== null) reasons.push(`Throughput knee at ${kneeVus} VUs: TPS gain below 10% while p95 grew over 50%`);
  const findings: Finding[] = [...ref.analysis.findings];
  findings.push({
    findingNo: 0, severity: 'INFO', kind: 'OTHER', title: kneeVus === null ? 'No scalability knee within the tested load' : `Scalability knee at ${kneeVus} VUs`,
    explanation: 'The Universal Scalability Law models throughput as X(N) = λN / (1 + σ(N-1) + κN(N-1)): σ is contention (serialized work such as a hot row) and κ is coherency delay (crosstalk). Past the peak N* = √((1-σ)/κ), adding users lowers throughput.',
    evidence: { points, kneeVus, sustainedVus, fit, littlesLaw: little }, fix: null,
  });
  findings.forEach((f, i) => { f.findingNo = i + 1; });

  const all = perStep.flatMap((s) => s.load.samples);
  const lockWaits = ref.load.lockWaits;
  const settings = loadSettings(ctx, ref.load, {
    capacity: { steps, stepDurationS: stepDur, warmupS: warm, reprovisionPerStep: reprovision, refStepVus: ref.vus }, littlesLaw: little,
    durationS: steps.length * stepDur, provision: provInfo,
  });
  await persistFinal({
    runId: ctx.runId, settings, totals: { ...totalsOf(ref.load), count: perStep.reduce((s, x) => s + x.load.totals.count, 0), committed: perStep.reduce((s, x) => s + x.load.totals.committed, 0), rejected: perStep.reduce((s, x) => s + x.load.totals.rejected, 0), errored: perStep.reduce((s, x) => s + x.load.totals.errored, 0), retries: perStep.reduce((s, x) => s + x.load.totals.retries, 0), deadlocks: perStep.reduce((s, x) => s + x.load.totals.deadlocks, 0), lockTimeouts: perStep.reduce((s, x) => s + x.load.totals.lockTimeouts, 0) },
    cacheHitRatio: ref.load.cache.ratio,
    slo: { pass: kneeVus === null && sloBrokenAt === null, reasons }, bottleneck: ref.analysis.bottleneck,
    samples: all, txnStats: ref.load.txnStats, statements: ref.analysis.statements, lockWaits, invariants: ref.analysis.invariants, findings,
    capacity: { points, fit, kneeVus, sustainedVus, sentence }, status: 'COMPLETED',
  });
}

/** Runs one pipeline to completion, mapping failures to run status + socket events. Never throws. */
async function guarded(ctx: RunCtx, fn: (c: RunCtx) => Promise<void>): Promise<RunSummary | null> {
  live.set(ctx.runId, ctx);
  try {
    await fn(ctx);
  } catch (err) {
    if (err instanceof ProvisionCancelled || ctx.cancelled) await failRun(ctx.runId, 'CANCELLED', 'Cancelled by the user').catch(() => undefined);
    else {
      const msg = err instanceof ServiceError ? err.message : (err as Error).message;
      console.error(`[run ${ctx.runId}]`, err);
      await failRun(ctx.runId, 'FAILED', msg).catch(() => undefined);
    }
  } finally {
    live.delete(ctx.runId);
  }
  const summary = await loadSummary(ctx.runId).catch(() => null);
  emitRun(ctx.runId, SOCKET_EVENTS.finished, { runId: ctx.runId, status: summary?.status ?? 'FAILED', sloPass: summary?.sloPass ?? null });
  return summary;
}

async function prepare(args: StartRunArgs, runId: string, kind: RunKind, parentRunId: string | null): Promise<RunCtx> {
  const resolved = resolveRun(args.design, args.overrides);
  const ctx: RunCtx = {
    runId, projectId: args.projectId, revisionNo: args.revisionNo, kind, parentRunId, database: sandboxName(args.projectId), design: args.design,
    overrides: args.overrides, strategyOverride: args.overrides.strategy, resolved, cancelled: false,
  };
  const capSteps = args.overrides.capacitySteps ?? resolved.design.capacity.steps;
  const capDur = args.overrides.capacityStepDurationS ?? resolved.design.capacity.stepDurationS;
  await createRunRow({
    runId, projectId: args.projectId, revisionNo: args.revisionNo, kind, parentRunId,
    settings: { kind, strategy: resolved.strategy, isolation: resolved.isolation, overrides: args.overrides }, strategy: resolved.strategy, isolation: resolved.isolation,
    vus: kind === 'CAPACITY' ? Math.max(...capSteps) : resolved.vus, durationS: kind === 'CAPACITY' ? capSteps.length * capDur : resolved.durationS, seed: resolved.seed,
  });
  return ctx;
}

/** Rejects fast with ServiceError(409, 'RUN_ACTIVE') when another run is active; 400 for invalid designs or an unreachable Redis. */
export async function startRun(args: StartRunArgs): Promise<{ runId: string; done: Promise<RunSummary> }> {
  await validateForRun(resolveRun(args.design, args.overrides).design); // 400s before 409s: a broken design never queues behind a run
  const runId = randomUUID();
  const release = await acquireGlobalLock(runId);
  let ctx: RunCtx;
  try {
    ctx = await prepare(args, runId, args.kindOverride ?? args.kind, args.parentRunId ?? null);
  } catch (err) { await release(); throw err; }
  const done = (async () => {
    try { return (await guarded(ctx, ctx.kind === 'CAPACITY' ? executeCapacity : executeLoad)) ?? (await loadSummary(runId))!; }
    finally { await release(); }
  })();
  return { runId, done };
}

/** Variants worth comparing: every variant defined by some transaction (`default` only when nothing else exists). */
export function definedVariants(design: DesignDoc): StrategyVariant[] {
  const set = new Set<StrategyVariant>();
  for (const t of design.workload.transactions) for (const v of Object.keys(t.variants) as StrategyVariant[]) set.add(v);
  // `default` is the naive flow when an explicit `naive` variant exists, so comparing both would run the same thing twice.
  if (set.has('naive')) set.delete('default');
  return STRATEGY_VARIANTS.filter((v) => set.has(v));
}

/** Tier 2: one short child run per defined variant with the same seed, all under a parent run, holding the global lock throughout. */
export async function startStrategyCompare(args: { projectId: string; revisionNo: number; design: DesignDoc; overrides: RunOverrides }): Promise<{ parentRunId: string; runIds: string[]; done: Promise<RunSummary[]> }> {
  const variants = definedVariants(args.design);
  if (variants.length === 0) throw new ServiceError(400, 'NO_VARIANTS', 'The workload has no strategy variants to compare');
  const parentRunId = randomUUID();
  const base: RunOverrides = { ...args.overrides };
  const users = args.design.nodes.find((n) => n.type === 'users');
  base.durationS = base.durationS ?? Math.min(users?.type === 'users' ? users.config.durationS : 10, 10);
  base.warmupS = base.warmupS ?? 2;
  const resolved = resolveRun(args.design, base);
  await validateForRun(resolved.design);
  const release = await acquireGlobalLock(parentRunId);
  const runIds = variants.map(() => randomUUID());
  try {
    await createRunRow({ runId: parentRunId, projectId: args.projectId, revisionNo: args.revisionNo, kind: 'LOAD', settings: { kind: 'compare-strategies', variants, overrides: base }, strategy: 'compare', isolation: resolved.isolation, vus: resolved.vus, durationS: base.durationS * variants.length, seed: resolved.seed });
    await setRunStatus(parentRunId, 'RUNNING', { startedAt: true });
    const done = (async () => {
      const out: RunSummary[] = [];
      try {
        for (let i = 0; i < variants.length; i++) {
          emitStatus(parentRunId, 'RUNNING', `Comparing strategies · ${variants[i]}`, { step: { n: i + 1, of: variants.length, vus: resolved.vus } });
          const ov: RunOverrides = { ...base, strategy: variants[i]!, seed: resolved.seed };
          const ctx = await prepare({ ...args, kind: 'LOAD', overrides: ov }, runIds[i]!, 'STRATEGY_CHILD', parentRunId);
          const s = await guarded(ctx, executeLoad);
          if (s) out.push(s);
          if (live.get(parentRunId)?.cancelled) break;
        }
        await persistFinalParent(parentRunId, out);
      } catch (err) {
        await failRun(parentRunId, 'FAILED', (err as Error).message).catch(() => undefined);
      } finally {
        live.delete(parentRunId);
        await release();
        const sm = await loadSummary(parentRunId).catch(() => null);
        emitRun(parentRunId, SOCKET_EVENTS.finished, { runId: parentRunId, status: sm?.status ?? 'FAILED', sloPass: null });
      }
      return out;
    })();
    live.set(parentRunId, { runId: parentRunId, projectId: args.projectId, revisionNo: args.revisionNo, kind: 'LOAD', parentRunId: null, database: '', design: args.design, overrides: base, resolved, cancelled: false });
    return { parentRunId, runIds, done };
  } catch (err) { await release(); throw err; }
}

async function persistFinalParent(parentRunId: string, children: RunSummary[]): Promise<void> {
  const cancelled = live.get(parentRunId)?.cancelled === true;
  const status: FinalRun['status'] = cancelled ? 'CANCELLED' : 'COMPLETED';
  const sum = (f: (s: RunSummary) => number) => children.reduce((a, s) => a + f(s), 0);
  await persistFinal({
    runId: parentRunId, settings: { kind: 'compare-strategies', children: children.map((c) => ({ runId: c.runId, strategy: c.strategy, tpsAvg: c.tpsAvg, p95Ms: c.p95Ms, invariantViolations: c.invariantViolations })) },
    totals: { count: sum((s) => s.txnTotal), committed: sum((s) => s.committed), rejected: sum((s) => s.rejected), errored: sum((s) => s.errored), retries: sum((s) => s.retries), deadlocks: sum((s) => s.deadlocks), lockTimeouts: sum((s) => s.lockTimeouts), tpsAvg: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 },
    cacheHitRatio: null, slo: null, bottleneck: null, samples: [], txnStats: [], statements: [], lockWaits: [], invariants: [], findings: [], status,
  });
}

export async function cancelRun(runId: string): Promise<boolean> {
  const ctx = live.get(runId);
  if (!ctx) return false;
  ctx.cancelled = true;
  for (const c of live.values()) if (c.parentRunId === runId) c.cancelled = true; // a comparison parent cancels its running child
  return true;
}
