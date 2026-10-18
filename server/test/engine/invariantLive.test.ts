import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SOCKET_EVENTS, type RunSample } from '@datasim/shared';
import { appPool } from '../../src/db/pool.js';
import { loadReport } from '../../src/engine/index.js';
import { setRunEmitter } from '../../src/realtime/runEmitter.js';
import { cleanupProject, makeProject, miniDesign, startRunWhenFree } from './helpers.js';

const samples: RunSample[] = [];
let projectId = '';

beforeAll(() => { setRunEmitter((_runId, event, payload) => { if (event === SOCKET_EVENTS.sample) samples.push((payload as { sample: RunSample }).sample); }); });
afterAll(async () => {
  setRunEmitter(null);
  if (projectId) await cleanupProject(projectId);
  await appPool.end().catch(() => undefined);
});

describe('Tier 2 live invariant sampling', () => {
  it('naive overbooking shows 0 at the baseline and growing violations in a later tick; nothing is persisted', async () => {
    // warm-up 0 so the baseline tick sees the untouched seed state; 7 s measured gives the t=0 and t=5 s ticks.
    const p = await makeProject(miniDesign({ users: { vus: 40, durationS: 7, warmupS: 0 } }));
    projectId = p.projectId;
    const { runId, done } = await startRunWhenFree({ projectId: p.projectId, revisionNo: p.revisionNo, design: p.design, kind: 'LOAD', overrides: { strategy: 'naive' } });
    const summary = await done;
    expect(summary.status).toBe('COMPLETED');

    const sampled = samples.filter((s) => s.invariants);
    expect(sampled.length, 'at least the baseline and the 5 s tick').toBeGreaterThanOrEqual(2);
    expect(sampled[0]!.invariants!.no_overbooking).toBe(0);
    expect(sampled[0]!.tS).toBeLessThanOrEqual(2);
    expect(Math.max(...sampled.map((s) => s.invariants!.no_overbooking!))).toBeGreaterThan(0);
    expect(samples.some((s) => (s.nodes?.d?.violations ?? 0) > 0)).toBe(true);

    // the persisted run carries only the authoritative post-run check
    const report = (await loadReport(runId))!;
    expect(report.invariants[0]!.violations).toBeGreaterThan(0);
    expect(report.samples.every((s) => s.invariants === undefined && s.nodes === undefined)).toBe(true);
  }, 300_000);
});
