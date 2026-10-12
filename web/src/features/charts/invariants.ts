import type { RunSample } from '@datasim/shared';

export interface InvariantSeries { names: string[]; rows: Array<Record<string, number>> }

/** Rows only for seconds where an invariant tick landed (Tier 2, every 5 s): `{ tS, <name>: violations }`. Empty when nothing was sampled. */
export function invariantSeries(samples: RunSample[]): InvariantSeries {
  const names: string[] = [];
  const rows: Array<Record<string, number>> = [];
  for (const s of samples) {
    if (!s.invariants || s.tS < 1) continue;
    for (const k of Object.keys(s.invariants)) if (!names.includes(k)) names.push(k);
    rows.push({ tS: s.tS, ...s.invariants });
  }
  return { names, rows };
}
