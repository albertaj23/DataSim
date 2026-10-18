// Seeded PRNG (mulberry32) and samplers. Never use Math.random for seeding or workload params.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over seed + string parts: derives an independent stream per table/column/vu. */
export function hashSeed(seed: number, ...parts: Array<string | number>): number {
  let h = 2166136261 ^ (seed >>> 0);
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= 0xff; h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private next: () => number;
  constructor(seed: number) { this.next = mulberry32(seed); }
  static derive(seed: number, ...parts: Array<string | number>): Rng { return new Rng(hashSeed(seed, ...parts)); }
  float(): number { return this.next(); }
  /** Inclusive integer range. */
  int(min: number, max: number): number {
    const lo = Math.ceil(Math.min(min, max)); const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(items: readonly T[]): T { return items[Math.floor(this.next() * items.length)]!; }
  /** Standard normal via Box-Muller. */
  gaussian(): number {
    const u = Math.max(this.next(), 1e-12); const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  exponential(mean: number): number { return -Math.log(Math.max(this.next(), 1e-12)) * mean; }
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0; for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) { r -= weights[i] ?? 1; if (r <= 0) return items[i]!; }
    return items[items.length - 1]!;
  }
}

/** Zipf sampler over ranks 1..n (P(k) ~ 1/k^s). Exact CDF for n <= 100k, continuous inversion above. */
export function zipfSampler(n: number, s: number): (rng: Rng) => number {
  if (n <= 1) return () => 1;
  if (n <= 100_000) {
    const cdf = new Float64Array(n);
    let sum = 0;
    for (let k = 1; k <= n; k++) { sum += 1 / Math.pow(k, s); cdf[k - 1] = sum; }
    return (rng) => {
      const target = rng.float() * sum;
      let lo = 0; let hi = n - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid]! < target) lo = mid + 1; else hi = mid; }
      return lo + 1;
    };
  }
  return (rng) => {
    const u = rng.float();
    const x = Math.abs(s - 1) < 1e-9
      ? Math.exp(u * Math.log(n + 1))
      : Math.pow(u * (Math.pow(n + 1, 1 - s) - 1) + 1, 1 / (1 - s));
    return Math.min(n, Math.max(1, Math.floor(x)));
  };
}
