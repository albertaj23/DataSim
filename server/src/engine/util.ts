// Small hot-path helpers: latency histogram, hrtime, sleeping, jitter.

/** Log-bucketed latency histogram (HDR-style, ~1% resolution, 0.01 ms .. ~10 min). O(1) record, no per-sample allocation. */
const GROWTH = 1.02;
const LN_GROWTH = Math.log(GROWTH);
const MIN_MS = 0.01;
const BUCKETS = 1100;

export class Histogram {
  private counts = new Uint32Array(BUCKETS);
  count = 0;
  sum = 0;
  min = Infinity;
  max = 0;

  record(ms: number): void {
    const v = ms < MIN_MS ? MIN_MS : ms;
    let i = Math.floor(Math.log(v / MIN_MS) / LN_GROWTH);
    if (i >= BUCKETS) i = BUCKETS - 1;
    this.counts[i]!++;
    this.count++;
    this.sum += ms;
    if (ms < this.min) this.min = ms;
    if (ms > this.max) this.max = ms;
  }

  mean(): number { return this.count ? this.sum / this.count : 0; }

  /** q in 0..1. Returns the bucket midpoint clamped to the observed [min, max]. */
  percentile(q: number): number {
    if (this.count === 0) return 0;
    const target = Math.max(1, Math.ceil(q * this.count));
    let acc = 0;
    for (let i = 0; i < BUCKETS; i++) {
      acc += this.counts[i]!;
      if (acc >= target) {
        const mid = MIN_MS * Math.pow(GROWTH, i + 0.5);
        return Math.min(this.max, Math.max(this.min, mid));
      }
    }
    return this.max;
  }

  merge(o: Histogram): void {
    for (let i = 0; i < BUCKETS; i++) this.counts[i]! += o.counts[i]!;
    this.count += o.count; this.sum += o.sum;
    if (o.min < this.min) this.min = o.min;
    if (o.max > this.max) this.max = o.max;
  }

  reset(): void { this.counts.fill(0); this.count = 0; this.sum = 0; this.min = Infinity; this.max = 0; }
}

export const hr = (): bigint => process.hrtime.bigint();
/** Milliseconds between two hrtime stamps. */
export const msSince = (t0: bigint, t1: bigint = process.hrtime.bigint()): number => Number(t1 - t0) / 1e6;

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Sleeps only if there is something to wait for (sub-0.05 ms delays are skipped). */
export const delay = (ms: number): Promise<void> | void => (ms > 0.05 ? sleep(ms) : undefined);

export const round = (v: number, d = 2): number => { const m = 10 ** d; return Math.round(v * m) / m; };
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
