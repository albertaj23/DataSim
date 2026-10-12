// Universal Scalability Law: X(N) = lambda*N / (1 + sigma*(N-1) + kappa*N*(N-1)).
// sigma = contention (serialization), kappa = coherency (crosstalk). Hand-written bounded least squares, no dependency.
export interface UslParams { lambda: number; sigma: number; kappa: number }
export interface UslPoint { n: number; x: number }
/** nPeak / xMax are null when the data show no saturation (see fitUsl): the fit is then an extrapolation, not a projection. */
export interface UslFit extends UslParams { nPeak: number | null; xMax: number | null; r2: number }

/** X(N) = lambda*N / (1 + sigma*(N-1) + kappa*N*(N-1)) */
export const uslThroughput = (n: number, p: UslParams): number => (p.lambda * n) / (1 + p.sigma * (n - 1) + p.kappa * n * (n - 1));

const shape = (n: number, s: number, k: number) => n / (1 + s * (n - 1) + k * n * (n - 1));
const N_CAP = 1e6;

/** For fixed (sigma, kappa) the best lambda is closed-form: sum(x*g) / sum(g*g). */
function evalSse(pts: UslPoint[], s: number, k: number): { sse: number; lambda: number } {
  let sxg = 0; let sgg = 0;
  for (const p of pts) { const g = shape(p.n, s, k); sxg += p.x * g; sgg += g * g; }
  const lambda = sgg > 0 ? Math.max(0, sxg / sgg) : 0;
  let sse = 0;
  for (const p of pts) { const d = p.x - lambda * shape(p.n, s, k); sse += d * d; }
  return { sse, lambda };
}

/** Peak of the fitted curve. kappa ~ 0 means no retrograde region: the curve saturates at lambda/sigma (capped). */
export function uslPeak(p: UslParams): { nPeak: number; xMax: number } {
  const nPeak = p.kappa > 1e-12 ? Math.min(N_CAP, Math.sqrt(Math.max(0, 1 - p.sigma) / p.kappa)) : N_CAP;
  const n = Math.max(1, nPeak);
  return { nPeak: n, xMax: p.kappa <= 1e-12 && p.sigma > 1e-9 ? p.lambda / p.sigma : uslThroughput(n, p) };
}

// Nelder-Mead on (a, b) with sigma = clamp(a^2, 0, 1), kappa = clamp(b^2, 0, 1): keeps both parameters >= 0.
function nelderMead(f: (v: [number, number]) => number, start: [number, number], step: [number, number]): [number, number] {
  let simplex: Array<{ v: [number, number]; f: number }> = [
    { v: start, f: f(start) },
    { v: [start[0] + step[0], start[1]], f: 0 },
    { v: [start[0], start[1] + step[1]], f: 0 },
  ];
  simplex[1]!.f = f(simplex[1]!.v); simplex[2]!.f = f(simplex[2]!.v);
  for (let it = 0; it < 400; it++) {
    simplex.sort((p, q) => p.f - q.f);
    const [best, , worst] = simplex as [typeof simplex[0], typeof simplex[0], typeof simplex[0]];
    if (Math.abs(worst.f - best.f) <= 1e-14 * (1 + Math.abs(best.f))) break;
    const c: [number, number] = [(simplex[0]!.v[0] + simplex[1]!.v[0]) / 2, (simplex[0]!.v[1] + simplex[1]!.v[1]) / 2];
    const at = (t: number): [number, number] => [c[0] + t * (worst.v[0] - c[0]), c[1] + t * (worst.v[1] - c[1])];
    const refl = at(-1); const fr = f(refl);
    if (fr < best.f) {
      const exp = at(-2); const fe = f(exp);
      simplex[2] = fe < fr ? { v: exp, f: fe } : { v: refl, f: fr };
    } else if (fr < simplex[1]!.f) {
      simplex[2] = { v: refl, f: fr };
    } else {
      const con = at(fr < worst.f ? -0.5 : 0.5); const fc = f(con);
      if (fc < Math.min(fr, worst.f)) simplex[2] = { v: con, f: fc };
      else simplex = simplex.map((s, i) => (i === 0 ? s : (() => { const v: [number, number] = [best.v[0] + 0.5 * (s.v[0] - best.v[0]), best.v[1] + 0.5 * (s.v[1] - best.v[1])]; return { v, f: f(v) }; })()));
    }
  }
  simplex.sort((p, q) => p.f - q.f);
  return simplex[0]!.v;
}

/**
 * Bounded least-squares USL fit (sigma, kappa >= 0). Grid search seeds a Nelder-Mead refinement; lambda is solved in closed form.
 * Needs >= 2 points with n >= 1. Returns null when the data cannot be fitted (fewer than 2 usable points).
 */
export function fitUsl(points: UslPoint[]): UslFit | null {
  const pts = points.filter((p) => Number.isFinite(p.n) && Number.isFinite(p.x) && p.n >= 1 && p.x >= 0);
  if (pts.length < 2) return null;
  const clampS = (a: number) => Math.min(1, a * a);
  const clampK = (b: number) => Math.min(1, b * b);
  const obj = (v: [number, number]) => evalSse(pts, clampS(v[0]), clampK(v[1])).sse;

  const sigmas = [0, 0.0005, 0.002, 0.005, 0.01, 0.02, 0.04, 0.08, 0.15, 0.3, 0.5, 0.8];
  const kappas = [0, 1e-8, 1e-7, 1e-6, 1e-5, 3e-5, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 1e-1];
  const seeds: Array<{ s: number; k: number; sse: number }> = [];
  for (const s of sigmas) for (const k of kappas) seeds.push({ s, k, sse: evalSse(pts, s, k).sse });
  seeds.sort((a, b) => a.sse - b.sse);

  let best = { s: seeds[0]!.s, k: seeds[0]!.k, sse: seeds[0]!.sse };
  for (const seed of seeds.slice(0, 4)) {
    const a0 = Math.sqrt(seed.s) || 0.01; const b0 = Math.sqrt(seed.k) || 0.001;
    const v = nelderMead(obj, [a0, b0], [Math.max(0.02, a0 * 0.3), Math.max(0.002, b0 * 0.3)]);
    const s = clampS(v[0]); const k = clampK(v[1]);
    const sse = evalSse(pts, s, k).sse;
    if (sse < best.sse) best = { s, k, sse };
  }
  const { lambda, sse } = evalSse(pts, best.s, best.k);
  const mean = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const sst = pts.reduce((a, p) => a + (p.x - mean) ** 2, 0);
  const r2 = sst > 0 ? Math.max(0, 1 - sse / sst) : 1;
  const params = { lambda, sigma: best.s, kappa: best.k };
  // Honesty guard: report a peak only when the data support one. kappa ~ 0, a peak far beyond the tested load or a ceiling far
  // above the best measured throughput is extrapolation, so nPeak/xMax stay null (a plain contention ceiling lambda/sigma is
  // kept as xMax when it is within 2x of the best measurement).
  const maxN = Math.max(...pts.map((p) => p.n)); const maxX = Math.max(...pts.map((p) => p.x));
  const pk = uslPeak(params);
  const retro = params.kappa >= 1e-7 && pk.nPeak <= 3 * maxN;
  const credible = pk.xMax <= 2 * maxX;
  return { ...params, nPeak: retro && credible ? pk.nPeak : null, xMax: credible ? pk.xMax : null, r2 };
}
