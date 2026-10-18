import { CircleCheck, GitCompare, Loader } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RunReport, RunSummary } from '@datasim/shared';
import { api } from '../../../lib/api';
import { formatMs, formatNumber, shortId } from '../../../lib/format';
import { Pill, TBody, TD, TH, THead, TR, Table, buttonClass } from '../../../ui';
import { compareHeadline, compareRows, comparableIds, type CompareRow, type CompareState } from '../compare';
import { useRunStore } from '../runStore';

const STATE_PILL: Record<CompareState, { tone: 'neutral' | 'blue' | 'green' | 'amber' | 'red'; text: string }> = {
  pending: { tone: 'neutral', text: 'pending' }, running: { tone: 'blue', text: 'running' }, done: { tone: 'green', text: 'done' },
  cancelled: { tone: 'amber', text: 'cancelled' }, failed: { tone: 'red', text: 'failed' },
};

/** Variants of the parent run and the child runs seen so far (polled while the batch runs). */
function useCompareRows(active: boolean): { rows: CompareRow[]; headline: string } {
  const projectId = useRunStore((s) => s.projectId);
  const runId = useRunStore((s) => s.runId);
  const childIds = useRunStore((s) => s.children);
  const currentChild = useRunStore((s) => s.currentChild);
  const step = useRunStore((s) => s.step);
  const report = useRunStore((s) => s.report);
  const [summaries, setSummaries] = useState<RunSummary[]>([]);
  const [variants, setVariants] = useState<string[]>([]);

  const settings = report?.run.runId === runId ? report?.settings : undefined;
  const reportVariants = Array.isArray(settings?.variants) ? (settings.variants as string[]) : [];
  const final = Array.isArray(settings?.children) ? (settings.children as { runId: string; strategy: string; tpsAvg: number; p95Ms: number; invariantViolations: number }[]) : [];

  useEffect(() => {
    if (!runId || reportVariants.length) return;
    let live = true;
    void api.get<RunReport>(`/runs/${runId}`).then((r) => { if (live && r.ok && Array.isArray(r.body.settings?.variants)) setVariants(r.body.settings.variants as string[]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, reportVariants.length]);

  useEffect(() => {
    if (!projectId || !runId) return;
    let live = true;
    const load = async () => {
      const res = await api.get<RunSummary[]>(`/runs?projectId=${projectId}&kind=STRATEGY_CHILD`);
      if (!live || !res.ok || !Array.isArray(res.body)) return;
      const mine = res.body.filter((r) => r.parentRunId === runId).sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
      setSummaries(mine);
      // Attached to a comparison already under way: follow the children that exist now (their live events feed the charts).
      const ids = mine.map((r) => r.runId);
      if (active && ids.length > useRunStore.getState().children.length) useRunStore.setState({ children: ids });
    };
    void load();
    if (!active) return () => { live = false; };
    const t = setInterval(() => void load(), 2000);
    return () => { live = false; clearInterval(t); };
  }, [projectId, runId, active]);

  const rows = useMemo(
    () => compareRows({ variants: reportVariants.length ? reportVariants : variants, childIds, summaries, currentChild, final }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reportVariants.length, variants, childIds, summaries, currentChild, settings],
  );
  return { rows, headline: compareHeadline(rows, step) };
}

/** Per-variant progress of a "Compare strategies" batch, and the result strip once it ends. Never shows KPIs for the parent itself. */
export function CompareLive({ active }: { active: boolean }) {
  const { rows, headline } = useCompareRows(active);
  const status = useRunStore((s) => s.status);
  const errorText = useRunStore((s) => s.report?.run.errorText);
  const ids = comparableIds(rows);
  const doneCount = rows.filter((r) => r.state === 'done').length;
  return (
    <div className="flex flex-col gap-2.5" data-testid="compare-live">
      {active && <div className="text-sm font-medium text-fg" data-testid="compare-headline">{headline}</div>}
      {!active && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs" data-testid="compare-strip">
          {status === 'COMPLETED'
            ? <Pill tone="green" className="font-medium" icon={<CircleCheck size={11} />}>COMPARED</Pill>
            : <Pill tone={status === 'FAILED' ? 'red' : 'amber'} className="font-medium">{(status ?? 'ended').toString()}</Pill>}
          <span className="text-fg">{status === 'FAILED' && errorText ? errorText : `${doneCount} of ${rows.length} variants finished with the same seed.`}</span>
          {ids.length >= 2 && (
            <Link to={`/compare?ids=${ids.join(',')}`} className={`ml-auto ${buttonClass('primary', 'sm')}`}><GitCompare size={14} />Open comparison</Link>
          )}
        </div>
      )}
      <Table>
        <THead><TR><TH>Variant</TH><TH>Status</TH><TH align="right">TPS</TH><TH align="right">p95</TH><TH align="right">Violations</TH><TH>Run</TH></TR></THead>
        <TBody>
          {rows.length === 0 && <TR><TD colSpan={6} className="py-3 text-center text-muted">Waiting for the first variant.</TD></TR>}
          {rows.map((r) => {
            const pill = STATE_PILL[r.state];
            return (
              <TR key={r.strategy} data-testid={`compare-row-${r.strategy}`}>
                <TD mono>{r.strategy}</TD>
                <TD><Pill tone={pill.tone} icon={r.state === 'running' ? <Loader size={11} className="ds-spin" /> : undefined}>{pill.text}</Pill></TD>
                <TD align="right" mono>{r.tpsAvg == null ? <span className="text-faint">-</span> : formatNumber(r.tpsAvg)}</TD>
                <TD align="right" mono>{r.p95Ms == null ? <span className="text-faint">-</span> : formatMs(r.p95Ms)}</TD>
                <TD align="right" mono className={r.violations ? 'text-bad' : undefined}>{r.violations == null ? <span className="text-faint">-</span> : formatNumber(r.violations)}</TD>
                <TD>{r.runId && r.state !== 'pending' ? <Link to={`/runs/${r.runId}`} className="font-mono text-xs text-accent hover:underline">{shortId(r.runId)}</Link> : <span className="text-faint">-</span>}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
