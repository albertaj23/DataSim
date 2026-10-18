import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { appPool } from '../../src/db/pool.js';
import { createRunRow } from '../../src/engine/store.js';
import { recoverStaleRuns } from '../../src/engine/index.js';
import { cleanupProject, makeProject, miniDesign } from './helpers.js';

const app = createApp();
const created: string[] = [];
afterAll(async () => { for (const id of created) await cleanupProject(id); await appPool.end().catch(() => undefined); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST a run, waiting while another suite holds the global lock. */
async function postRun(projectId: string, body: object): Promise<string> {
  for (let i = 0; i < 240; i++) {
    const res = await request(app).post(`/api/projects/${projectId}/runs`).send(body);
    if (res.status === 409) { await sleep(1000); continue; }
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    return res.body.runId as string;
  }
  throw new Error('run lock never freed');
}
async function waitDone(runId: string): Promise<any> {
  for (let i = 0; i < 240; i++) {
    const res = await request(app).get(`/api/runs/${runId}`);
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(res.body.run?.status)) return res.body;
    await sleep(500);
  }
  throw new Error('run did not finish');
}

describe('REST: runs, compare, exports', () => {
  it('start -> 409 on a second run -> poll report -> list -> exports -> compare -> cancel finished', async () => {
    const p = await makeProject(miniDesign()); created.push(p.projectId);
    const id1 = await postRun(p.projectId, { kind: 'LOAD', overrides: { strategy: 'atomic', durationS: 2, warmupS: 1, vus: 10 } });
    const busy = await request(app).post(`/api/projects/${p.projectId}/runs`).send({ kind: 'LOAD' });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('RUN_ACTIVE');
    expect(busy.body.message).toMatch(/in progress/i);
    const r1 = await waitDone(id1);
    expect(r1.run.status).toBe('COMPLETED');
    expect(r1.run.strategy).toBe('atomic');
    expect(r1.design.nodes).toHaveLength(3);
    expect(r1.samples.length).toBeGreaterThan(0);

    const id2 = await postRun(p.projectId, { kind: 'LOAD', overrides: { strategy: 'naive', durationS: 2, warmupS: 1, vus: 10 } });
    await waitDone(id2);

    const list = await request(app).get(`/api/runs?projectId=${p.projectId}`);
    expect(list.status).toBe(200);
    expect(list.body.map((r: any) => r.runId).sort()).toEqual([id1, id2].sort());
    expect((await request(app).get(`/api/runs?projectId=${p.projectId}&kind=CAPACITY`)).body).toEqual([]);
    expect((await request(app).get('/api/runs?kind=NOPE')).status).toBe(400);

    const md = await request(app).get(`/api/runs/${id1}/export.md`);
    expect(md.status).toBe(200);
    expect(md.headers['content-type']).toMatch(/markdown/);
    expect(md.text).toContain('# DataSim run report');
    expect(md.text).toContain('MEASURED');
    const csv = await request(app).get(`/api/runs/${id1}/export.csv`);
    expect(csv.headers['content-type']).toMatch(/csv/);
    expect(csv.text.split('\n')[0]).toBe('t_s,tps,p50_ms,p95_ms,p99_ms,errors,active_vus,app_queue,pool_waiting,threads_running,row_lock_waits,lock_wait_ms,bp_hit_ratio,cache_hit_ratio,retries,deadlocks');
    expect((await request(app).get(`/api/runs/${id1}/export.csv?part=txn`)).text).toContain('register');

    const cmp = await request(app).post('/api/compare').send({ runIds: [id1, id2] });
    expect(cmp.status).toBe(200);
    expect(cmp.body.runs.map((r: any) => r.run.runId)).toEqual([id1, id2]);
    expect((await request(app).post('/api/compare').send({ runIds: [id1] })).status).toBe(400);
    expect((await request(app).post('/api/compare').send({ runIds: [id1, '00000000-0000-4000-8000-000000000000'] })).status).toBe(404);

    expect((await request(app).post(`/api/runs/${id1}/cancel`)).status).toBe(409);
    expect((await request(app).get('/api/runs/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  }, 300_000);

  it('cancels an active run over REST', async () => {
    const p = await makeProject(miniDesign({ users: { durationS: 30, warmupS: 1 } })); created.push(p.projectId);
    const id = await postRun(p.projectId, { kind: 'LOAD' });
    await sleep(2500);
    expect((await request(app).post(`/api/runs/${id}/cancel`)).status).toBe(200);
    const r = await waitDone(id);
    expect(r.run.status).toBe('CANCELLED');
  }, 120_000);

  it('compare-strategies returns the parent and child run ids; children appear under the parent', async () => {
    const p = await makeProject(miniDesign()); created.push(p.projectId);
    let res;
    for (let i = 0; i < 240; i++) {
      res = await request(app).post(`/api/projects/${p.projectId}/compare-strategies`).send({ overrides: { durationS: 2, warmupS: 1, vus: 10 } });
      if (res.status !== 409) break;
      await sleep(1000);
    }
    expect(res!.status, JSON.stringify(res!.body)).toBe(202);
    const { parentRunId, runIds } = res!.body;
    expect(runIds).toHaveLength(2);
    const parent = await waitDone(parentRunId);
    expect(parent.run.status).toBe('COMPLETED');
    for (const rid of runIds) expect((await waitDone(rid)).run.parentRunId).toBe(parentRunId);
  }, 300_000);
});

describe('REST: sandbox', () => {
  it('provision -> test-txn -> query', async () => {
    const p = await makeProject(miniDesign()); created.push(p.projectId);
    let prov;
    for (let i = 0; i < 240; i++) { prov = await request(app).post(`/api/projects/${p.projectId}/sandbox/provision`).send({}); if (prov.status !== 409) break; await sleep(1000); }
    expect(prov!.status, JSON.stringify(prov!.body)).toBe(200);
    expect(prov!.body).toMatchObject({ tables: 3, rows: 2001 });
    const t = await request(app).post(`/api/projects/${p.projectId}/sandbox/test-txn`).send({ txnName: 'search' });
    expect(t.status).toBe(200);
    expect(t.body.outcome).toBe('COMMITTED_THEN_ROLLED_BACK');
    expect(t.body.steps[0].rowCount).toBeGreaterThan(0);
    expect((await request(app).post(`/api/projects/${p.projectId}/sandbox/test-txn`).send({ txnName: 'nope' })).status).toBe(404);
    const q = await request(app).post(`/api/projects/${p.projectId}/sandbox/query`).send({ sql: 'SELECT COUNT(*) AS n FROM item' });
    expect(q.body).toMatchObject({ columns: ['n'], rows: [[2000]], truncated: false });
    expect((await request(app).post(`/api/projects/${p.projectId}/sandbox/query`).send({ sql: 'UPDATE item SET name = 1' })).status).toBe(400);
  }, 120_000);

  it('maps a bad schema to a 400 naming the table', async () => {
    const d = miniDesign();
    d.schema.tables[0]!.checks.push({ expr: '`ghost` > 1' });
    const p = await makeProject(d); created.push(p.projectId);
    let res;
    for (let i = 0; i < 240; i++) { res = await request(app).post(`/api/projects/${p.projectId}/sandbox/provision`).send({}); if (res.status !== 409) break; await sleep(1000); }
    expect(res!.status).toBe(400);
    expect(res!.body.code).toBe('DDL_ERROR');
    expect(res!.body.table).toBe('seat_section');
  }, 120_000);
});

describe('startup recovery', () => {
  it('marks stale non-terminal runs FAILED', async () => {
    const p = await makeProject(miniDesign()); created.push(p.projectId);
    const runId = '11111111-2222-4333-8444-' + Date.now().toString(16).padStart(12, '0').slice(-12);
    await createRunRow({ runId, projectId: p.projectId, revisionNo: p.revisionNo, kind: 'LOAD', settings: {}, strategy: 'default', isolation: 'REPEATABLE READ', vus: 1, durationS: 1, seed: 1 });
    await appPool.query("UPDATE run SET status = 'RUNNING' WHERE run_id = ?", [runId]);
    for (let i = 0; i < 120; i++) {
      await recoverStaleRuns();
      const [rows] = await appPool.query<any[]>('SELECT status, error_text FROM run WHERE run_id = ?', [runId]);
      if (rows[0].status === 'FAILED') { expect(rows[0].error_text).toMatch(/restarted/i); return; }
      await sleep(1000);
    }
    throw new Error('stale run was never recovered');
  }, 150_000);
});
