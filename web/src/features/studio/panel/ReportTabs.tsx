import { ArrowRight, CircleCheck, CircleX } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { Finding, FindingFix, InvariantResult, RunReport, StatementStat, TxnStat } from '@datasim/shared';
import { api, errorMessage } from '../../../lib/api';
import { formatMs, formatNumber } from '../../../lib/format';
import { Button, Dialog, EmptyState, Pill, ProvenanceTag, TBody, TD, TH, THead, TR, Table, useToast } from '../../../ui';
import { TimeBar, TimeLegend } from '../../charts';
import { useReportActions } from '../../report/actions';
import { FindingCard } from '../../report/FindingsSection';
import { aggregateLockWaits, rerunKind } from '../../report/logic';
import { LockAggTable, WaitGraph } from '../../report/LockWaits';
import { loadDesign, flushSave } from '../persist';
import { useRunActions } from '../runFlow';
import { isActive, useRunStore, type LogEntry } from '../runStore';

/** Shared empty state for tabs that need a finished run. */
export function NoReport({ what }: { what: string }) {
  const active = useRunStore(isActive);
  return (
    <div className="flex h-full items-center justify-center p-4">
      <EmptyState className="w-full max-w-[460px] border-0 py-6" title={active ? 'Run in progress' : 'No finished run yet'} description={active ? `${what} appear when the run finishes. Watch the Live tab meanwhile.` : `Run the design to see ${what.toLowerCase()}.`} />
    </div>
  );
}

const Scroll = ({ children }: { children: ReactNode }) => <div className="h-full overflow-auto p-3">{children}</div>;
const NA = <span className="text-faint">-</span>;

// ---------------------------------------------------------------- transactions
export function TransactionsTab({ report }: { report: RunReport | null }) {
  if (!report) return <NoReport what="Per-transaction latency" />;
  const rows: TxnStat[] = report.txnStats;
  const slo = report.design.slo;
  return (
    <Scroll>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted">Where the time went <ProvenanceTag kind="MEASURED" /><span className="text-faint">network and app are emulated delays that really ran in the request path</span></div>
        <TimeLegend />
      </div>
      <Table>
        <THead><TR>
          <TH>Transaction</TH><TH align="right">Count</TH><TH align="right">Rejected</TH><TH align="right">Errors</TH><TH align="right">Retries</TH><TH align="right">Deadlocks</TH>
          <TH align="right">p50</TH><TH align="right">p95</TH><TH align="right">p99</TH><TH className="w-[260px]">Time per request</TH>
        </TR></THead>
        <TBody>
          {rows.length === 0 && <TR><TD colSpan={10} className="py-4 text-center text-muted">No transactions were measured.</TD></TR>}
          {rows.map((t) => {
            const target = slo.perTxn[t.txnName] ?? slo.p95Ms;
            return (
              <TR key={t.txnName}>
                <TD mono>{t.txnName}</TD>
                <TD align="right" mono>{formatNumber(t.count)}</TD>
                <TD align="right" mono>{formatNumber(t.rejected)}</TD>
                <TD align="right" mono className={t.errored ? 'text-bad' : undefined}>{formatNumber(t.errored)}</TD>
                <TD align="right" mono>{formatNumber(t.retries)}</TD>
                <TD align="right" mono className={t.deadlocks ? 'text-warn' : undefined}>{formatNumber(t.deadlocks)}</TD>
                <TD align="right" mono>{formatMs(t.p50Ms)}</TD>
                <TD align="right" mono className={t.p95Ms > target ? 'text-bad' : undefined}>{formatMs(t.p95Ms)}</TD>
                <TD align="right" mono>{formatMs(t.p99Ms)}</TD>
                <TD><TimeBar parts={t} /></TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </Scroll>
  );
}

// ---------------------------------------------------------------- statements
export function StatementsTab({ report }: { report: RunReport | null }) {
  const [explain, setExplain] = useState<StatementStat | null>(null);
  const rows = useMemo(() => (report ? [...report.statementStats].sort((a, b) => b.avgMs * b.execCount - a.avgMs * a.execCount) : []), [report]);
  if (!report) return <NoReport what="Statement statistics" />;
  return (
    <Scroll>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">Top statements by total time <ProvenanceTag kind="MEASURED" /><span className="text-faint">performance_schema digests for this run&rsquo;s schema</span></div>
      <Table>
        <THead><TR>
          <TH>Statement</TH><TH>Transaction</TH><TH align="right">Execs</TH><TH align="right">Avg</TH><TH align="right">Max</TH><TH align="right">Rows examined</TH><TH align="right">Lock time</TH><TH>Index</TH><TH />
        </TR></THead>
        <TBody>
          {rows.length === 0 && <TR><TD colSpan={9} className="py-4 text-center text-muted">No statements were captured for this run.</TD></TR>}
          {rows.map((s) => (
            <TR key={s.digest}>
              <TD className="max-w-[360px]"><span title={s.digestText} className="block truncate font-mono text-xs">{s.digestText}</span></TD>
              <TD mono className="text-muted">{s.txnName ?? NA}</TD>
              <TD align="right" mono>{formatNumber(s.execCount)}</TD>
              <TD align="right" mono>{formatMs(s.avgMs)}</TD>
              <TD align="right" mono>{formatMs(s.maxMs)}</TD>
              <TD align="right" mono>{formatNumber(s.rowsExamined)}</TD>
              <TD align="right" mono>{formatMs(s.lockTimeMs)}</TD>
              <TD>{s.noIndexUsed > 0 ? <Pill tone="amber">no index</Pill> : <Pill tone="green">index</Pill>}</TD>
              <TD align="right"><Button size="sm" variant="ghost" disabled={s.explain == null} onClick={() => setExplain(s)}>EXPLAIN</Button></TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Dialog open={!!explain} onOpenChange={(o) => !o && setExplain(null)} title="EXPLAIN" description={explain?.txnName ? `Statement of ${explain.txnName}` : undefined} width={720}>
        {explain && (
          <div className="flex flex-col gap-3">
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-2 p-2.5 font-mono text-xs text-fg">{explain.digestText}</pre>
            <pre className="max-h-[360px] overflow-auto rounded-lg border border-line bg-surface-2 p-2.5 font-mono text-xs text-muted">{JSON.stringify(explain.explain, null, 2)}</pre>
          </div>
        )}
      </Dialog>
    </Scroll>
  );
}

// ---------------------------------------------------------------- locks
export function LocksTab({ report }: { report: RunReport | null }) {
  const live = useRunStore((s) => s.locks);
  const active = useRunStore(isActive);
  const agg = useMemo(() => aggregateLockWaits(report?.lockWaits ?? []), [report]);
  if (active) {
    return (
      <Scroll>
        <div className="mb-2 flex items-center gap-2 text-xs text-muted">Wait-for graph, live <ProvenanceTag kind="MEASURED" /><span className="text-faint">sampled from performance_schema.data_lock_waits, at most twice a second</span></div>
        {live.length === 0 ? <p className="py-6 text-center text-sm text-muted">No transaction is waiting for a lock right now.</p> : (
          <ul className="flex flex-col gap-1">
            {live.map((e, i) => (
              <li key={`${e.waiting}-${e.blocking}-${i}`} className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-xs">
                <span className="text-fg">{e.waiting}</span><ArrowRight size={12} className="text-faint" /><span className="text-warn">{e.blocking}</span>
                <span className="ml-auto text-muted">{[e.table, e.mode].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
      </Scroll>
    );
  }
  if (!report) return <NoReport what="Lock waits" />;
  return (
    <Scroll>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">Lock waits observed <ProvenanceTag kind="MEASURED" /><span className="text-faint">{formatNumber(report.lockWaits.length)} sampled waits, grouped by waiter, blocker and lock</span></div>
      {report.lockWaits.length === 0 ? <p className="py-6 text-center text-sm text-muted">No lock waits were observed during the measured window.</p> : (
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="rounded-lg border border-line bg-surface p-3">
            <div className="mb-1 text-xs text-muted">Wait-for graph &middot; arrow = waits for</div>
            <WaitGraph rows={report.lockWaits} />
          </div>
          <LockAggTable agg={agg} />
        </div>
      )}
    </Scroll>
  );
}

// ---------------------------------------------------------------- invariants
export function InvariantsTab({ report }: { report: RunReport | null }) {
  if (!report) return <NoReport what="Invariant checks" />;
  const rows: InvariantResult[] = report.invariants;
  return (
    <Scroll>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">Invariants checked after the run <ProvenanceTag kind="MEASURED" /><span className="text-faint">each query returns the number of violating rows; 0 passes</span></div>
      <Table>
        <THead><TR><TH>Invariant</TH><TH>Description</TH><TH align="right">Violations</TH><TH>Result</TH></TR></THead>
        <TBody>
          {rows.length === 0 && <TR><TD colSpan={4} className="py-4 text-center text-muted">This design defines no invariants. Add them in the workload editor.</TD></TR>}
          {rows.map((r) => (
            <TR key={r.name}>
              <TD mono>{r.name}</TD>
              <TD className="max-w-[420px] text-muted"><span className="block truncate" title={r.error ?? r.description}>{r.error ? <span className="text-bad">{r.error}</span> : r.description || NA}</span></TD>
              <TD align="right" mono className={r.violations > 0 ? 'text-bad' : undefined}>{formatNumber(r.violations)}</TD>
              <TD>{r.passed ? <Pill tone="green" icon={<CircleCheck size={11} />}>pass</Pill> : <Pill tone="red" icon={<CircleX size={11} />}>fail</Pill>}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Scroll>
  );
}

// ---------------------------------------------------------------- findings
/** Same finding cards as the report page; the fix is applied to the draft here and the canvas reloads it. */
export function FindingsTab({ report }: { report: RunReport | null }) {
  return report ? <FindingsBody report={report} /> : <NoReport what="Advisor findings" />;
}

function FindingsBody({ report }: { report: RunReport }) {
  const toast = useToast();
  const projectId = report.run.projectId;
  const base = useReportActions(report);
  const run = useRunActions(projectId);
  const [applied, setApplied] = useState<Record<string, number>>({});
  const [showInfo, setShowInfo] = useState(false);
  const runId = report.run.runId;

  const actions = {
    busy: base.busy,
    applyFix: async (fix: FindingFix, label: string) => {
      if (!(await flushSave())) { toast.error('Could not save the draft first'); return null; }
      const rev = await base.applyFix(fix, label);
      if (rev === null) return null;
      const res = await api.get<{ revisionNo: number; design: RunReport['design'] }>(`/projects/${projectId}/revisions/${rev}`);
      if (res.ok) loadDesign(projectId, res.body.design, rev);
      else toast.error('Fix applied, but the revision could not be reloaded', errorMessage(res));
      return rev;
    },
    rerun: async () => { await run.start(rerunKind(report)); return true; },
  };
  const main = report.findings.filter((f) => f.severity !== 'INFO');
  const info = report.findings.filter((f) => f.severity === 'INFO');
  const card = (f: Finding) => (
    <FindingCard key={f.findingNo} f={f} projectId={projectId} inStudio actions={actions} applied={applied[`${runId}:${f.findingNo}`]} onApplied={(rev) => setApplied((a) => ({ ...a, [`${runId}:${f.findingNo}`]: rev }))} />
  );

  return (
    <Scroll>
      {report.findings.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">The advisor found nothing to flag in this run.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface" data-testid="findings-list">
          <div className="divide-y divide-line">{(showInfo ? [...main, ...info] : main).map(card)}</div>
          {info.length > 0 && (
            <div className="border-t border-line px-3 py-1.5">
              <Button size="sm" variant="ghost" onClick={() => setShowInfo((v) => !v)}>{showInfo ? 'Hide informational findings' : `Show ${info.length} informational finding${info.length === 1 ? '' : 's'}`}</Button>
            </div>
          )}
        </div>
      )}
    </Scroll>
  );
}

// ---------------------------------------------------------------- log
const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour12: false });
const DOT: Record<LogEntry['tone'], string> = { neutral: 'bg-faint', ok: 'bg-ok', bad: 'bg-bad' };

export function LogTab() {
  const log = useRunStore((s) => s.log);
  if (log.length === 0) return <NoReport what="The status timeline" />;
  return (
    <Scroll>
      <ol className="flex flex-col gap-1">
        {log.map((l, i) => (
          <li key={`${l.at}-${i}`} className="flex items-center gap-2.5 text-xs">
            <span className="w-[60px] shrink-0 font-mono text-faint tnum">{clock(l.at)}</span>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[l.tone]}`} />
            <span className="text-fg">{l.text}</span>
          </li>
        ))}
      </ol>
    </Scroll>
  );
}
