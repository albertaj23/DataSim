import { config } from '../config.js';
import { appPool } from '../db/pool.js';
import { prepareForStrategy } from '../strategies/artifacts.js';
import type { StrategyName } from '../strategies/index.js';

/** A request that is well-formed but not allowed in the current state. Maps to HTTP 400/404/409. */
export class ServiceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: object = {}) {
    super(message);
    this.name = 'ServiceError';
  }
}

// The Concurrency Lab runs its legacy experiments on the playback_session tables with this strategy.
let liveStrategy: StrategyName = config.DEFAULT_STRATEGY;
export const getLiveStrategy = () => liveStrategy;

/** CONSTRAINT needs the unique index; every other strategy needs it GONE (see strategies/artifacts.ts). */
export async function setLiveStrategy(name: StrategyName): Promise<void> {
  const conn = await appPool.getConnection();
  try { await prepareForStrategy(conn, name); } finally { conn.release(); }
  liveStrategy = name;
}
