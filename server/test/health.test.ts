import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePools } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrations.js';
import { ensureRunnerUser } from '../src/db/runner.js';

afterAll(closePools);

describe('GET /api/health', () => {
  it('reports MySQL, Redis and the restricted runner user', async () => {
    await runMigrations();
    await ensureRunnerUser();
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.mysql.version).toMatch(/^8\.4\./);
    expect(res.body.mysql.performanceSchema).toBe(true);
    expect(res.body.runner.ok).toBe(true);
    expect(res.body.redis.ok).toBe(true);
    expect(res.body.ok).toBe(true);
  });
});
