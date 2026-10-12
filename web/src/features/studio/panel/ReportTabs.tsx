import { ArrowRight, Check, CircleCheck, CircleX, Wrench } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { Finding, InvariantResult, RunReport, Severity, StatementStat, TxnStat } from '@datasim/shared';
import { api, errorMessage } from '../../../lib/api';
import { useDesignStore } from '../../../lib/designStore';
import { formatMs, formatNumber } from '../../../lib/format';
import { Button, Dialog, EmptyState, Pill, ProvenanceTag, TBody, TD, TH, THead, TR, Table, useToast, type Tone } from '../../../ui';
import { TimeBar, TimeLegend } from '../../charts';
import { loadDesign, flushSave } from '../persist';
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
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">Lock waits observed <ProvenanceTag kind="MEASURED" /><span className="text-faint">first sighting of each waiter, blocker and lock</span></div>
      {report.lockWaits.length === 0 ? <p className="py-6 text-center text-sm text-muted">No lock waits were observed during the measured window.</p> : (
        <Table>
          <THead><TR><TH align="right">At</TH><TH>Waiting</TH><TH /><TH>Blocking</TH><TH>Table</TH><TH>Index</TH><TH>Mode</TH><TH>Lock data</TH></TR></THead>
          <TBody>
            {report.lockWaits.map((w) => (
              <TR key={w.seq}>
                <TD align="right" mono className="text-muted">{formatMs(w.atMs)}</TD>
                <TD mono>{w.waitingTxn}</TD>
                <TD><ArrowRight size={12} className="text-faint" /></TD>
                <TD mono className="text-warn">{w.blockingTxn}</TD>
                <TD mono>{w.tableName}</TD>
                <TD mono className="text-muted">{w.indexName ?? NA}</TD>
                <TD mono className="text-muted">{w.lockMode}</TD>
                <TD mono className="max-w-[200px] truncate text-muted" title={w.lockData ?? undefined}>{w.lockData ?? NA}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
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
const SEV_TONE: Record<Severity, Tone> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'blue', INFO: 'neutral' };

/** Scalars and short string lists only; nested objects are noise in a pill (null = skip). */
function evidenceText(v: unknown): string | null {
  if (typeof v === 'number') return Number.isInteger(v) ? formatNumber(v) : String(Number(v.toFixed(2)));
  if (typeof v === 'string' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.length <= 4 && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join(', ');
  return null;
}

export function FindingsTab({ report }: { report: RunReport | null }) {
  const toast = useToast();
  const projectId = useDesignStore((s) => s.projectId);
  const [busy, setBusy] = useState<number | null>(null);
  const [applied, setApplied] = useState<Record<string, number>>({});
  if (!report) return <NoReport what="Advisor findings" />;
  const runId = report.run.runId;

  const apply = async (f: Finding) => {
    if (!f.fix || !projectId) return;
    setBusy(f.findingNo);
    try {
      if (!(await flushSave())) { toast.error('Could not save the draft first'); return; }
      const res = await api.post<{ revisionNo: number }>(`/projects/${projectId}/apply-fix`, { fix: f.fix, note: f.fixLabel ?? f.title });
      if (!res.ok) { toast.error('Could not apply the fix', errorMessage(res)); return; }
      const rev = await api.get<{ revisionNo: number; design: RunReport['design'] }>(`/projects/${projectId}/revisions/${res.body.revisionNo}`);
      if (!rev.ok) { toast.error('Fix applied, but the revision could not be reloaded', errorMessage(rev)); return; }
      loadDesign(projectId, rev.body.design, res.body.revisionNo);
      setApplied((a) => ({ ...a, [`${runId}:${f.findingNo}`]: res.body.revisionNo }));
      toast.success(`Applied: ${f.fixLabel ?? f.title}`, `rev ${res.body.revisionNo}. Run again to see the effect.`);
    } finally { setBusy(null); }
  };

  return (
    <Scroll>
      {report.findings.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">The advisor found nothing to flag in this run.</p>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {report.findings.map((f) => {
            const rev = applied[`${runId}:${f.findingNo}`];
            const evidence = Object.entries(f.evidence ?? {}).filter(([, v]) => evidenceText(v) !== null).slice(0, 8) as [string, unknown][];
            return (
              <li key={f.findingNo} className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3">
                <div className="flex items-start gap-2">
                  <Pill tone={SEV_TONE[f.severity]} className="mt-px font-medium">{f.severity.toLowerCase()}</Pill>
                  <h4 className="min-w-0 flex-1 text-sm font-medium text-fg">{f.title}</h4>
                </div>
                <p className="text-xs leading-[18px] text-muted">{f.explanation}</p>
                {evidence.length > 0 && (
                  <dl className="flex flex-wrap gap-1.5">
                    {evidence.map(([k, v]) => (
                      <div key={k} className="flex max-w-full items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px]">
                        <dt className="text-faint">{k}</dt><dd className="truncate text-fg" title={evidenceText(v) ?? ''}>{evidenceText(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {f.fix && (
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <span className="text-xs text-faint">{f.fixLabel}</span>
                    {rev ? <Pill tone="green" icon={<Check size={11} />}>applied &middot; rev {rev}</Pill> : (
                      <Button size="sm" variant="primary" icon={<Wrench size={14} />} loading={busy === f.findingNo} onClick={() => void apply(f)} data-testid="apply-fix">Apply fix</Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
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
