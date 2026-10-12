import { Router } from 'express';
import { Redis } from 'ioredis';
import type { RowDataPacket } from 'mysql2/promise';
import type { HealthResponse } from '@datasim/shared';
import { config } from '../config.js';
import { appPool } from '../db/pool.js';
import { runnerOk } from '../db/runner.js';
import { getActiveRunId } from '../engine/active.js';

export const healthRouter = Router();

/** Short-lived probe so health never flips the lazy Redis client's `inUse` flag. */
async function redisPing(): Promise<{ ok: boolean; error?: string }> {
  const r = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 0, lazyConnect: true, connectTimeout: 1500, retryStrategy: () => null });
  r.on('error', () => undefined);
  try { await r.connect(); await r.ping(); return { ok: true }; }
  catch (err) { return { ok: false, error: (err as Error).message }; }
  finally { r.disconnect(); }
}

export async function collectHealth(): Promise<HealthResponse> {
  let mysql: HealthResponse['mysql'];
  try {
    const [v] = await appPool.query<RowDataPacket[]>('SELECT VERSION() AS version');
    const [ps] = await appPool.query<RowDataPacket[]>("SHOW VARIABLES LIKE 'performance_schema'");
    mysql = { ok: true, version: v[0]!.version as string, performanceSchema: String(ps[0]?.Value).toUpperCase() === 'ON' };
  } catch (err) { mysql = { ok: false, version: null, performanceSchema: false, error: (err as Error).message }; }
  const [redis, runner] = await Promise.all([redisPing(), mysql.ok ? runnerOk() : Promise.resolve({ ok: false, error: 'database offline' })]);
  return { ok: mysql.ok && mysql.performanceSchema && redis.ok && runner.ok, mysql, redis, runner, activeRunId: getActiveRunId() };
}

healthRouter.get('/health', async (_req, res) => {
  const h = await collectHealth();
  res.status(h.mysql.ok ? 200 : 503).json(h);
});
