import { describe, expect, it } from 'vitest';
import type { InvariantResult } from '@datasim/shared';
import { InvariantSampler, sumViolations } from '../../src/engine/invariantSampler.js';

const res = (name: string, violations: number, error?: string): InvariantResult => ({ name, sql: 'x', violations, passed: violations === 0 && !error, ...(error ? { error } : {}) });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('InvariantSampler', () => {
  it('ticks every interval, never overlaps and hands out each result once', async () => {
    let t = 0; let calls = 0; let release!: () => void;
    const s = new InvariantSampler(() => { calls++; return new Promise((r) => { release = () => r([res('a', calls), res('b', 0)]); }); }, () => t, 5000, 0);
    expect(s.maybeTick()).toBe(true);          // baseline
    t = 6000;
    expect(s.maybeTick()).toBe(false);         // previous still running: skipped
    expect(calls).toBe(1);
    release(); await flush();
    expect(s.take()).toEqual({ a: 1, b: 0 });
    expect(s.take()).toBeUndefined();          // once only
    expect(s.latest).toEqual({ a: 1, b: 0 });  // but the latest value stays for the node pill
    t = 4000;
    expect(s.maybeTick()).toBe(false);         // interval not elapsed yet
    t = 6000;
    expect(s.maybeTick()).toBe(true);
    expect(calls).toBe(2);
  });

  it('swallows errors into a warn counter', async () => {
    let t = 0; let n = 0;
    const s = new InvariantSampler(async () => { if (n++ === 0) throw new Error('boom'); return [res('a', 3), res('bad', 0, 'syntax')]; }, () => t, 5000, 0);
    s.maybeTick(); await flush();
    expect(s.warns).toBe(1); expect(s.take()).toBeUndefined();
    t = 5000; s.maybeTick(); await flush();
    expect(s.warns).toBe(2);                   // the errored invariant counts, the good one is kept
    expect(s.take()).toEqual({ a: 3 });
    expect(sumViolations(s.latest)).toBe(3);
    expect(sumViolations(undefined)).toBe(0);
  });
});
