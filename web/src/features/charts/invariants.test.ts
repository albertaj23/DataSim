import { describe, expect, it } from 'vitest';
import type { RunSample } from '@datasim/shared';
import { invariantSeries } from './invariants';

const s = (tS: number, invariants?: Record<string, number>): RunSample => ({
  tS, tps: 1, p50Ms: 1, p95Ms: 1, p99Ms: 1, errors: 0, activeVus: 1, appQueue: 0, poolWaiting: 0, threadsRunning: 0, rowLockWaits: 0, lockWaitMs: 0, bpHitRatio: null, cacheHitRatio: null, invariants,
});

describe('invariantSeries', () => {
  it('keeps only the sampled seconds, in order, with the union of names', () => {
    const r = invariantSeries([s(0, { a: 0 }), s(1, { a: 0, b: 0 }), s(2), s(3), s(6, { a: 4, b: 1 }), s(7), s(11, { a: 9 })]);
    expect(r.names).toEqual(['a', 'b']);
    expect(r.rows).toEqual([{ tS: 1, a: 0, b: 0 }, { tS: 6, a: 4, b: 1 }, { tS: 11, a: 9 }]);
  });
  it('is empty when no sampling happened', () => {
    expect(invariantSeries([s(1), s(2)])).toEqual({ names: [], rows: [] });
    expect(invariantSeries([])).toEqual({ names: [], rows: [] });
  });
});
