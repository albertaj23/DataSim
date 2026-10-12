// Capacity-test math: knee detection, sustained load, Little's-law check and the report sentence (brief 4.5). Pure functions.
import type { CapacityFit, CapacityPoint } from '@datasim/shared';

export interface SloLimits { p95Ms: number; maxErrorPct: number }

const breaks = (p: CapacityPoint, slo: SloLimits) => p.p95Ms > slo.p95Ms || p.errorRate * 100 > slo.maxErrorPct;

/**
 * Knee = first step where TPS gains < 10% while p95 grows > 50% versus the previous step, or where the SLO breaks.
 * Sustained = the largest step at which every step so far met the SLO (null when even the first step breaks it).
 */
export function analyzeSteps(points: CapacityPoint[], slo: SloLimits): { kneeVus: number | null; sustainedVus: number | null; sloBrokenAt: number | null } {
  const pts = [...points].sort((a, b) => a.vus - b.vus);
  let kneeVus: number | null = null; let sloBrokenAt: number | null = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (sloBrokenAt === null && breaks(p, slo)) sloBrokenAt = p.vus;
    if (i === 0 || kneeVus !== null) continue;
    const prev = pts[i - 1]!;
    const gain = prev.tps > 0 ? (p.tps - prev.tps) / prev.tps : 0;
    if (gain < 0.1 && p.p95Ms > prev.p95Ms * 1.5) kneeVus = p.vus;
  }
  if (sloBrokenAt !== null && (kneeVus === null || sloBrokenAt < kneeVus)) kneeVus = sloBrokenAt;
  let sustainedVus: number | null = null;
  for (const p of pts) {
    if (breaks(p, slo)) break;
    sustainedVus = p.vus;
  }
  return { kneeVus, sustainedVus, sloBrokenAt };
}

/** Little's law: N ≈ X · (R + Z). Returns the predicted concurrency and its ratio to the configured VUs for each step. */
export function littlesLaw(points: CapacityPoint[], meanRespMs: number[], thinkMeanMs: number): Array<{ vus: number; predicted: number; ratio: number }> {
  return points.map((p, i) => {
    const predicted = p.tps * ((meanRespMs[i] ?? 0) + thinkMeanMs) / 1000;
    return { vus: p.vus, predicted: Math.round(predicted * 10) / 10, ratio: p.vus > 0 ? Math.round((predicted / p.vus) * 100) / 100 : 0 };
  });
}

const sig3 = (v: number) => {
  if (v >= 100) { const mag = 10 ** (Math.floor(Math.log10(v)) - 2); return Math.round(v / mag) * mag; }
  return Math.round(v * 10) / 10;
};
const fmt = (v: number) => Math.round(sig3(v)).toLocaleString('en-US');

/** "Sustains ~1,240 tps at p95 ≤ 200 ms up to ~140 VUs; projected peak ~1,410 tps at ~180 VUs (USL, R² 0.97)." */
export function capacitySentence(points: CapacityPoint[], fit: CapacityFit | null, slo: SloLimits, a: { kneeVus: number | null; sustainedVus: number | null }): string {
  const pts = [...points].sort((x, y) => x.vus - y.vus);
  const first = pts[0];
  if (!first) return 'No capacity steps completed.';
  const sustained = pts.find((p) => p.vus === a.sustainedVus);
  let head: string;
  if (!sustained) {
    head = `Does not meet p95 ≤ ${slo.p95Ms} ms${first.errorRate * 100 > slo.maxErrorPct && first.p95Ms <= slo.p95Ms ? ` / error rate ≤ ${slo.maxErrorPct}%` : ''} even at ${first.vus} VUs (p95 ${Math.round(first.p95Ms)} ms, ${fmt(first.tps)} tps)`;
  } else {
    // Interpolate where p95 crosses the target between the last passing and the first failing step.
    const next = pts.find((p) => p.vus > sustained.vus);
    let vusAt = sustained.vus; let tpsAt = sustained.tps;
    if (next && next.p95Ms > slo.p95Ms && next.p95Ms > sustained.p95Ms) {
      const f = (slo.p95Ms - sustained.p95Ms) / (next.p95Ms - sustained.p95Ms);
      vusAt = sustained.vus + f * (next.vus - sustained.vus); tpsAt = sustained.tps + f * (next.tps - sustained.tps);
    }
    const atLeast = !next ? 'at least ' : '';
    head = `Sustains ~${fmt(tpsAt)} tps at p95 ≤ ${slo.p95Ms} ms up to ${atLeast}~${Math.round(vusAt)} VUs`;
  }
  if (!fit || fit.xMax <= 0) return `${head}.`;
  const r2 = fit.r2.toFixed(2);
  if (fit.nPeak >= 1e5) {
    // No coherency term: the curve never turns down. With contention it still saturates at lambda/sigma.
    const ceiling = fit.sigma > 1e-4 ? fit.lambda / fit.sigma : null;
    return ceiling !== null ? `${head}; the USL fit has no retrograde region and levels off near ~${fmt(ceiling)} tps (USL, R² ${r2}).` : `${head}; no saturation is visible within the tested load, so the USL fit (R² ${r2}) is still linear.`;
  }
  return `${head}; projected peak ~${fmt(fit.xMax)} tps at ~${Math.round(fit.nPeak)} VUs (USL, R² ${r2}).`;
}
