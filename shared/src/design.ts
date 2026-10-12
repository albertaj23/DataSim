import { z } from 'zod';
import { SchemaModel, ValueGenerator, Ident } from './schema';

export const ISOLATIONS = ['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'] as const;
export const Isolation = z.enum(ISOLATIONS);
export type Isolation = z.infer<typeof Isolation>;

/** Concurrency-control variant selected on the App server. Templates lacking a variant fall back to `default`. */
export const STRATEGY_VARIANTS = ['default', 'naive', 'pessimistic', 'optimistic', 'atomic', 'serializable'] as const;
export const StrategyVariant = z.enum(STRATEGY_VARIANTS);
export type StrategyVariant = z.infer<typeof StrategyVariant>;

// ---------------------------------------------------------------- workload
const Operand = z.string().min(1); // `$bind.col`, `:param`, or a numeric literal
const CmpOp = z.enum(['=', '!=', '<', '<=', '>', '>=']);
export const Step = z.object({
  sql: z.string().min(1),
  bindAs: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).optional(),
  guard: z.object({ left: Operand, op: CmpOp, right: Operand, onFail: z.literal('reject').default('reject') }).optional(),
  expectAffected: z.object({ op: CmpOp, value: z.number().int(), onFail: z.enum(['reject', 'retry']) }).optional(),
});
export type Step = z.infer<typeof Step>;

export const Transaction = z.object({
  name: Ident,
  weight: z.number().min(0).max(1000),
  readOnly: z.boolean().default(false),
  cacheable: z.boolean().default(false),
  description: z.string().default(''),
  params: z.record(z.string(), ValueGenerator).default({}),
  /** strategy variant -> steps; must contain `default`. */
  variants: z.record(StrategyVariant, z.array(Step).min(1)).refine((v) => !!v.default, 'a `default` variant is required'),
});
export type Transaction = z.infer<typeof Transaction>;

export const Invariant = z.object({ name: Ident, description: z.string().default(''), sql: z.string().min(1) });
export type Invariant = z.infer<typeof Invariant>;

export const Workload = z.object({ transactions: z.array(Transaction).default([]), invariants: z.array(Invariant).default([]) });
export type Workload = z.infer<typeof Workload>;

// ---------------------------------------------------------------- topology
export const NODE_TYPES = ['users', 'lb', 'app', 'redis', 'mysql'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const UsersConfig = z.object({
  vus: z.number().int().min(1).max(500).default(100),
  thinkMinMs: z.number().min(0).max(60_000).default(50),
  thinkMaxMs: z.number().min(0).max(60_000).default(150),
  thinkDist: z.enum(['uniform', 'exponential', 'fixed']).default('uniform'),
  pattern: z.enum(['constant', 'ramp', 'spike', 'step']).default('constant'),
  durationS: z.number().min(1).max(600).default(20),
  warmupS: z.number().min(0).max(60).default(3),
});
export const LbConfig = z.object({ algorithm: z.enum(['round-robin', 'least-connections']).default('round-robin') });
export const AppConfig = z.object({
  instances: z.number().int().min(1).max(8).default(1),
  workers: z.number().int().min(1).max(256).default(32),
  processingMeanMs: z.number().min(0).max(5000).default(2),
  processingJitterMs: z.number().min(0).max(5000).default(1),
  poolSize: z.number().int().min(1).max(100).default(16),
  strategy: StrategyVariant.default('default'),
  retry: z.object({ max: z.number().int().min(0).max(10).default(3), backoffMs: z.number().min(0).max(5000).default(10) }).default({}),
});
export const RedisConfig = z.object({ ttlS: z.number().int().min(1).max(86_400).default(30) });
export const MysqlConfig = z.object({
  isolation: Isolation.default('REPEATABLE READ'),
  lockWaitTimeoutS: z.number().int().min(1).max(60).default(3),
  /** 0 = unlimited. */
  maxExecutionTimeMs: z.number().int().min(0).max(600_000).default(0),
});
export type UsersConfig = z.infer<typeof UsersConfig>;
export type LbConfig = z.infer<typeof LbConfig>;
export type AppConfig = z.infer<typeof AppConfig>;
export type RedisConfig = z.infer<typeof RedisConfig>;
export type MysqlConfig = z.infer<typeof MysqlConfig>;

const Pos = z.object({ x: z.number(), y: z.number() });
const nodeBase = { id: z.string().min(1), name: z.string().min(1).max(60), position: Pos };
export const DesignNode = z.discriminatedUnion('type', [
  z.object({ ...nodeBase, type: z.literal('users'), config: UsersConfig }),
  z.object({ ...nodeBase, type: z.literal('lb'), config: LbConfig }),
  z.object({ ...nodeBase, type: z.literal('app'), config: AppConfig }),
  z.object({ ...nodeBase, type: z.literal('redis'), config: RedisConfig }),
  z.object({ ...nodeBase, type: z.literal('mysql'), config: MysqlConfig }),
]);
export type DesignNode = z.infer<typeof DesignNode>;

export const DesignEdge = z.object({
  id: z.string().min(1), source: z.string(), target: z.string(),
  latencyMs: z.number().min(0).max(2000).default(1),
  jitterMs: z.number().min(0).max(2000).default(0),
});
export type DesignEdge = z.infer<typeof DesignEdge>;

export const Slo = z.object({
  p95Ms: z.number().positive().default(200),
  maxErrorPct: z.number().min(0).max(100).default(1),
  perTxn: z.record(z.string(), z.number().positive()).default({}),
});
export type Slo = z.infer<typeof Slo>;

export const CapacitySettings = z.object({
  steps: z.array(z.number().int().min(1).max(500)).min(2).max(10).default([10, 25, 50, 100, 200]),
  stepDurationS: z.number().min(2).max(120).default(10),
});

/** The editor document: versioned, read and written whole (hence JSON in `design_revision`). */
export const DesignDoc = z.object({
  schemaVersion: z.literal(1).default(1),
  nodes: z.array(DesignNode).default([]),
  edges: z.array(DesignEdge).default([]),
  schema: SchemaModel.default({ tables: [] }),
  workload: Workload.default({ transactions: [], invariants: [] }),
  slo: Slo.default({}),
  capacity: CapacitySettings.default({}),
  /** PRNG seed for seeding data and workload params. */
  seed: z.number().int().default(42),
});
export type DesignDoc = z.infer<typeof DesignDoc>;
export const emptyDesign = (): DesignDoc => DesignDoc.parse({});
