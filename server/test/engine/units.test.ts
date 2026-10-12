import { describe, expect, it } from 'vitest';
import { fitUsl, uslThroughput } from '@datasim/shared';
import type { CapacityPoint } from '@datasim/shared';
import { analyzeSteps, capacitySentence, littlesLaw } from '../../src/engine/capacity.js';
import { actionFor, classifyError } from '../../src/engine/classify.js';
import { assertSafeStatement, compare, compileSql } from '../../src/engine/exec.js';
import { targetVus } from '../../src/engine/load.js';
import { Histogram } from '../../src/engine/util.js';
import { aliasMap, plansAccesses, predicateColumns } from '../../src/engine/analysis.js';

describe('fitUsl', () => {
  it('recovers known parameters from noise-free points', () => {
    const truth = { lambda: 120, sigma: 0.04, kappa: 0.0006 };
    const pts = [1, 2, 4, 8, 16, 32, 64, 128].map((n) => ({ n, x: uslThroughput(n, truth) }));
    const fit = fitUsl(pts)!;
    expect(fit.lambda).toBeCloseTo(truth.lambda, 0);
    expect(fit.sigma).toBeCloseTo(truth.sigma, 3);
    expect(fit.kappa).toBeCloseTo(truth.kappa, 5);
    expect(fit.r2).toBeGreaterThan(0.9999);
    expect(fit.nPeak).toBeCloseTo(Math.sqrt((1 - truth.sigma) / truth.kappa), 0);
    expect(fit.xMax).toBeCloseTo(uslThroughput(fit.nPeak, truth), 0);
  });

  it('fits the default capacity steps and tolerates noise', () => {
    const truth = { lambda: 15, sigma: 0.02, kappa: 0.00005 };
    const noise = [1.02, 0.97, 1.01, 0.99, 1.03];
    const pts = [10, 25, 50, 100, 200].map((n, i) => ({ n, x: uslThroughput(n, truth) * noise[i]! }));
    const fit = fitUsl(pts)!;
    expect(fit.sigma).toBeGreaterThanOrEqual(0);
    expect(fit.kappa).toBeGreaterThanOrEqual(0);
    expect(fit.r2).toBeGreaterThan(0.97);
  });

  it('keeps both coefficients non-negative for a linear curve and reports no retrograde peak', () => {
    const fit = fitUsl([1, 2, 4, 8].map((n) => ({ n, x: 50 * n })))!;
    expect(fit.sigma).toBeLessThan(1e-3);
    expect(fit.kappa).toBeLessThan(1e-6);
    expect(fit.nPeak).toBeGreaterThanOrEqual(1e5);
  });

  it('returns null with fewer than two points', () => {
    expect(fitUsl([{ n: 1, x: 10 }])).toBeNull();
  });
});

describe('capacity analysis', () => {
  const pt = (stepNo: number, vus: number, tps: number, p95Ms: number, errorRate = 0): CapacityPoint => ({ stepNo, vus, tps, p50Ms: p95Ms / 2, p95Ms, errorRate });
  const slo = { p95Ms: 200, maxErrorPct: 1 };

  it('finds the knee when TPS saturates while p95 explodes', () => {
    const pts = [pt(1, 10, 100, 20), pt(2, 25, 240, 25), pt(3, 50, 460, 60), pt(4, 100, 480, 150), pt(5, 200, 470, 600)];
    const a = analyzeSteps(pts, slo);
    expect(a.kneeVus).toBe(100);
    expect(a.sloBrokenAt).toBe(200);
    expect(a.sustainedVus).toBe(100);
    expect(capacitySentence(pts, { lambda: 12, sigma: 0.03, kappa: 0.0001, nPeak: 98, xMax: 500, r2: 0.97 }, slo, a)).toMatch(/^Sustains ~[\d,]+ tps at p95 ≤ 200 ms up to ~\d+ VUs; projected peak ~[\d,]+ tps at ~\d+ VUs \(USL, R² 0\.97\)\.$/);
  });

  it('breaks at the first step when the SLO is already violated', () => {
    const pts = [pt(1, 10, 100, 400), pt(2, 25, 120, 900)];
    const a = analyzeSteps(pts, slo);
    expect(a.sustainedVus).toBeNull();
    expect(capacitySentence(pts, null, slo, a)).toContain('Does not meet p95 ≤ 200 ms even at 10 VUs');
  });

  it('flags an error-rate breach as the SLO break', () => {
    const a = analyzeSteps([pt(1, 10, 100, 20), pt(2, 25, 200, 30, 0.05)], slo);
    expect(a.kneeVus).toBe(25);
    expect(a.sustainedVus).toBe(10);
  });

  it("applies Little's law N ≈ X·(R+Z)", () => {
    const l = littlesLaw([pt(1, 10, 80, 20)], [25], 100);
    expect(l[0]!.predicted).toBeCloseTo(10, 0);
    expect(l[0]!.ratio).toBeCloseTo(1, 1);
  });
});

describe('error classification', () => {
  it('maps MySQL errnos to classes and actions', () => {
    const e = (errno: number) => ({ errno });
    expect(classifyError(e(1213))).toBe('deadlock');
    expect(classifyError(e(1205))).toBe('lock_timeout');
    expect(classifyError(e(1062))).toBe('duplicate');
    expect(classifyError(e(3819))).toBe('check');
    expect(classifyError(e(1452))).toBe('fk');
    expect(classifyError(e(3024))).toBe('timeout');
    expect(classifyError(new Error('boom'))).toBe('other');
    expect(actionFor('deadlock')).toBe('retry');
    expect(actionFor('lock_timeout')).toBe('retry');
    expect(actionFor('duplicate')).toBe('reject');
    expect(actionFor('check')).toBe('reject');
    expect(actionFor('fk')).toBe('error');
    expect(actionFor('timeout')).toBe('error');
  });
});

describe('sql handling', () => {
  it('rewrites named and bound placeholders to positional slots, ignoring string literals', () => {
    const c = compileSql("UPDATE s SET e = :$s.enrolled + 1, note = ':notaparam', t = :t WHERE id = :sid AND x = :sid");
    expect(c.text).toBe("UPDATE s SET e = ? + 1, note = ':notaparam', t = ? WHERE id = ? AND x = ?");
    expect(c.slots).toEqual([{ k: 'b', bind: 's', col: 'enrolled' }, { k: 'p', name: 't' }, { k: 'p', name: 'sid' }, { k: 'p', name: 'sid' }]);
  });
  it('accepts DML/SELECT/WITH only and rejects multi-statements', () => {
    expect(() => assertSafeStatement('SELECT 1')).not.toThrow();
    expect(() => assertSafeStatement('with x as (select 1) select * from x;')).not.toThrow();
    expect(() => assertSafeStatement('DROP TABLE x')).toThrow();
    expect(() => assertSafeStatement('SELECT 1; DELETE FROM x')).toThrow();
    expect(() => assertSafeStatement("SELECT ';' ")).not.toThrow();
  });
  it('compares numerically when both sides are numeric, never on null', () => {
    expect(compare('9', '<', 10)).toBe(true);
    expect(compare(null, '=', null)).toBe(false);
    expect(compare('a', '!=', 'b')).toBe(true);
  });
});

describe('histogram and load patterns', () => {
  it('reports percentiles within ~2% of exact values', () => {
    const h = new Histogram();
    for (let i = 1; i <= 1000; i++) h.record(i / 10); // 0.1 .. 100 ms
    expect(h.percentile(0.5)).toBeGreaterThan(48);
    expect(h.percentile(0.5)).toBeLessThan(52);
    expect(h.percentile(0.95)).toBeGreaterThan(93);
    expect(h.percentile(0.95)).toBeLessThan(97);
    expect(h.percentile(0.99)).toBeLessThanOrEqual(100);
    expect(h.count).toBe(1000);
  });
  it('shapes VUs for constant, ramp, spike and step', () => {
    expect(targetVus('constant', 100, 5, 3, 20)).toBe(100);
    expect(targetVus('ramp', 100, 0, 3, 20)).toBeLessThan(10);
    expect(targetVus('ramp', 100, 20, 3, 20)).toBe(100);
    expect(targetVus('spike', 100, 1, 3, 20)).toBe(20);
    expect(targetVus('spike', 100, 8, 3, 20)).toBe(100);
    expect(targetVus('spike', 100, 22, 3, 20)).toBe(20);
    expect(targetVus('step', 100, 0, 3, 17)).toBe(25);
    expect(targetVus('step', 100, 19, 3, 17)).toBe(100);
  });
});

describe('plan helpers', () => {
  const plan = { query_block: { nested_loop: [{ table: { table_name: 's', access_type: 'ALL', rows_examined_per_scan: 1200, attached_condition: "((`dsim_x`.`s`.`slot` = 'A1') and (`dsim_x`.`s`.`course_id` = `dsim_x`.`c`.`course_id`))" } }, { table: { table_name: 'c', access_type: 'eq_ref', key: 'PRIMARY', rows_examined_per_scan: 1 } }] } };
  it('extracts accesses and predicate columns', () => {
    const acc = plansAccesses(plan);
    expect(acc).toHaveLength(2);
    expect(acc[0]).toMatchObject({ table: 's', accessType: 'ALL', rows: 1200 });
    expect(predicateColumns('s', acc[0]!.condition, '')).toEqual(['slot']);
    expect(aliasMap('SELECT * FROM section s JOIN course AS c ON c.course_id = s.course_id WHERE s.slot = :slot').get('s')).toBe('section');
  });
});
