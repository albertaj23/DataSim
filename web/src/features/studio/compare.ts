import { isTerminal, type RunReport, type RunStatus, type RunSummary } from '@datasim/shared';

/** The parent row of "Compare strategies": it has no metrics of its own, only child runs. */
export function isCompareReport(report: Pick<RunReport, 'settings'> | null | undefined): boolean {
  return report?.settings?.kind === 'compare-strategies';
}

interface FinalChild { runId: string; strategy: string; tpsAvg: number; p95Ms: number; invariantViolations: number }

export type CompareState = 'pending' | 'running' | 'done' | 'cancelled' | 'failed';
export interface CompareRow { strategy: string; runId: string | null; state: CompareState; tpsAvg: number | null; p95Ms: number | null; violations: number | null }

const stateOf = (status: RunStatus | undefined, isCurrent: boolean): CompareState => {
  if (!status) return isCurrent ? 'running' : 'pending';
  if (!isTerminal(status)) return 'running';
  return status === 'COMPLETED' ? 'done' : status === 'CANCELLED' ? 'cancelled' : 'failed';
};

/**
 * One row per variant, in run order. `childIds[i]` is the run of `variants[i]` (the server creates them in that order);
 * `summaries` are the child runs seen so far, `final` the children stored on the finished parent.
 */
export function compareRows(args: {
  variants: string[]; childIds: string[]; summaries: RunSummary[]; currentChild: string | null; final: FinalChild[];
}): CompareRow[] {
  const byId = new Map(args.summaries.map((s) => [s.runId, s]));
  const finalById = new Map(args.final.map((f) => [f.runId, f]));
  const names = args.variants.length ? args.variants : args.final.map((f) => f.strategy);
  return names.map((strategy, i) => {
    const runId = args.childIds[i] ?? args.final.find((f) => f.strategy === strategy)?.runId ?? args.summaries.find((x) => x.strategy === strategy)?.runId ?? null;
    const s = runId ? byId.get(runId) : undefined;
    const f = runId ? finalById.get(runId) : undefined;
    const state = f ? 'done' : stateOf(s?.status, runId !== null && runId === args.currentChild);
    if (state !== 'done') return { strategy, runId, state, tpsAvg: null, p95Ms: null, violations: null };
    return { strategy, runId, state, tpsAvg: f?.tpsAvg ?? s?.tpsAvg ?? null, p95Ms: f?.p95Ms ?? s?.p95Ms ?? null, violations: f?.invariantViolations ?? s?.invariantViolations ?? null };
  });
}

/** "Comparing strategies · step 2/4 · pessimistic" (step from the parent's status events, else the first unfinished row). */
export function compareHeadline(rows: CompareRow[], step: { n: number; of: number } | null): string {
  const n = step?.n ?? Math.min(rows.findIndex((r) => r.state !== 'done') + 1 || rows.length, rows.length);
  const of = step?.of ?? rows.length;
  const name = rows[n - 1]?.strategy;
  return `Comparing strategies · step ${n}/${of}${name ? ` · ${name}` : ''}`;
}

/** Runs worth opening in the comparison page (finished children, at most 4 like the report page). */
export const comparableIds = (rows: CompareRow[]): string[] => rows.filter((r) => r.state === 'done' && r.runId).map((r) => r.runId!).slice(0, 4);
