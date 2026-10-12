import type { InvariantResult } from '@datasim/shared';

/**
 * Tier 2: runs the design invariants every `everyMs` while the measured window is open.
 * Never overlaps with itself (a tick is skipped while the previous check is running), never throws,
 * and counts failed checks in `warns` instead of surfacing them. The final post-run check stays authoritative.
 */
export class InvariantSampler {
  warns = 0;
  /** Latest violations per invariant; survives between ticks (drives the mysql node pill). */
  latest: Record<string, number> | undefined;
  private fresh: Record<string, number> | undefined;
  private running = false;
  private lastStart = -Infinity;

  constructor(private check: () => Promise<InvariantResult[]>, private now: () => number = Date.now, private everyMs = 5000, private slackMs = 200) {}

  /** Starts a check if none is running and the interval has elapsed. Returns true if one was started. */
  maybeTick(): boolean {
    const t = this.now();
    if (this.running || t - this.lastStart < this.everyMs - this.slackMs) return false;
    this.running = true; this.lastStart = t;
    this.check().then((rs) => {
      const out: Record<string, number> = {};
      for (const r of rs) { if (r.error) this.warns++; else out[r.name] = r.violations; }
      if (Object.keys(out).length) { this.latest = out; this.fresh = out; }
    }, () => { this.warns++; }).finally(() => { this.running = false; });
    return true;
  }

  /** The newest result, once: attach it to exactly one live sample. */
  take(): Record<string, number> | undefined {
    const f = this.fresh; this.fresh = undefined; return f;
  }
}

export const sumViolations = (v: Record<string, number> | undefined): number => (v ? Object.values(v).reduce((s, x) => s + x, 0) : 0);
