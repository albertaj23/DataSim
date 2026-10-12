// Template outcome tests: each built-in template must reproduce its teaching outcome on the real engine and MySQL.
// OUTCOME_REPEAT=3 runs every case three times (used when tuning template parameters).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunOverrides, RunReport, StrategyVariant } from '@datasim/shared';
import { appPool, closePools } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrations.js';
import { ensureRunnerUser } from '../../src/db/runner.js';
import { createProjectFromDesign, pinCurrent } from '../../src/projects/service.js';
import { buildTemplate } from '../../src/templates/index.js';

const engine = await import('../../src/engine/index.js').catch(() => null);
const REPEAT = Number(process.env.OUTCOME_REPEAT ?? 1);
const created: string[] = [];

beforeAll(async () => { await runMigrations(); await ensureRunnerUser(); });
afterAll(async () => {
  if (created.length) {
    await appPool.query('DELETE FROM run WHERE project_id IN (?)', [created]);
    await appPool.query('DELETE FROM project WHERE project_id IN (?)', [created]);
    for (const id of created) await appPool.query('DROP DATABASE IF EXISTS `' + engine!.sandboxName(id) + '`');
  }
  await closePools();
});

async function run(templateKey: string, overrides: RunOverrides): Promise<RunReport> {
  const design = buildTemplate(templateKey);
  const projectId = await createProjectFromDesign(`outcome ${templateKey}`, design);
  created.push(projectId);
  const { revisionNo } = await pinCurrent(projectId, 'outcome test');
  // another process (e.g. a different builder's test) may hold the global run lock: wait for it
  let started: Awaited<ReturnType<NonNullable<typeof engine>["startRun"]>> | undefined;
  for (let i = 0; !started; i++) {
    try { started = await engine!.startRun({ projectId, revisionNo, design, kind: 'LOAD', overrides }); } catch (e) {
      if ((e as { code?: string }).code !== 'RUN_ACTIVE' || i > 40) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  const { runId, done } = started;
  await done;
  const report = await engine!.loadReport(runId);
  expect(report, 'report exists').not.toBeNull();
  expect(report!.run.status, report!.run.errorText ?? '').toBe('COMPLETED');
  return report!;
}
const violations = (r: RunReport, name: string) => r.invariants.find((i) => i.name === name)?.violations ?? NaN;
const each = (n: number, fn: () => Promise<void>) => async () => { for (let i = 0; i < n; i++) await fn(); };

const short = { durationS: 8, warmupS: 1, rowScale: 0.25 } as const;
const withStrategy = (strategy: StrategyVariant, extra: RunOverrides = {}): RunOverrides => ({ ...short, strategy, ...extra });

describe.skipIf(!engine)('T1 course registration', () => {
  it('naive overbooks sections and loses counter updates', each(REPEAT, async () => {
    const r = await run('course-registration', withStrategy('naive'));
    expect(violations(r, 'no_overbooking')).toBeGreaterThan(0);
    expect(violations(r, 'counter_consistent')).toBeGreaterThan(0);
  }), 120_000);
  for (const s of ['atomic', 'pessimistic', 'optimistic'] as const) {
    it(`${s} keeps both invariants at zero`, each(REPEAT, async () => {
      const r = await run('course-registration', withStrategy(s));
      expect(violations(r, 'no_overbooking')).toBe(0);
      expect(violations(r, 'counter_consistent')).toBe(0);
      expect(r.run.committed).toBeGreaterThan(0);
    }), 120_000);
  }
});

describe.skipIf(!engine)('T2 shared resource allocation', () => {
  it('naive exceeds quotas', each(REPEAT, async () => {
    expect(violations(await run('shared-resource', withStrategy('naive')), 'within_quota')).toBeGreaterThan(0);
  }), 120_000);
  for (const s of ['pessimistic', 'optimistic', 'serializable'] as const) {
    it(`${s} never exceeds quota`, each(REPEAT, async () => {
      const r = await run('shared-resource', withStrategy(s));
      expect(violations(r, 'within_quota')).toBe(0);
      expect(r.run.committed).toBeGreaterThan(0);
    }), 120_000);
  }
});

describe.skipIf(!engine)('T3 flash sale', () => {
  it('naive oversells', each(REPEAT, async () => {
    expect(violations(await run('flash-sale', withStrategy('naive')), 'stock_non_negative')).toBeGreaterThan(0);
  }), 120_000);
  it('atomic never oversells and conserves stock', each(REPEAT, async () => {
    const r = await run('flash-sale', withStrategy('atomic'));
    expect(violations(r, 'stock_non_negative')).toBe(0);
    expect(violations(r, 'stock_conserved')).toBe(0);
  }), 120_000);
});

describe.skipIf(!engine)('T4 bank transfers', () => {
  it('unordered locking deadlocks but conserves money', each(REPEAT, async () => {
    const r = await run('bank-transfers', withStrategy('naive'));
    expect(r.run.deadlocks).toBeGreaterThan(0);
    expect(violations(r, 'money_conserved')).toBe(0);
  }), 120_000);
  it('ordered locking has no deadlocks', each(REPEAT, async () => {
    const r = await run('bank-transfers', withStrategy('pessimistic'));
    expect(r.run.deadlocks).toBe(0);
    expect(violations(r, 'money_conserved')).toBe(0);
  }), 120_000);
});
