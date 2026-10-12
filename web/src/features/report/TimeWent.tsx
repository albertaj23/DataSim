import type { RunReport, TxnStat } from '@datasim/shared';
import { formatMs, formatNumber } from '../../lib/format';
import { Pill, TBody, TD, TH, THead, TR, Table, cn } from '../../ui';
import { TIME_PARTS, TimeBar, TimeLegend } from '../charts';
import { phaseShare } from './logic';
import { Panel, Section } from './Section';

/** Stacked bar per transaction: queue / network / app / pool wait / database, scaled to the slowest transaction. */
export function TimeWent({ txns }: { txns: TxnStat[] }) {
  const totals = txns.map((t) => phaseShare(t).total);
  const max = Math.max(...totals, 0);
  return (
    <Section id="time" title="Where the time went" aside="mean ms per request">
      <Panel className="p-3">
        <TimeLegend className="mb-3" />
        {txns.length === 0 ? (
          <p className="py-6 text-center text-xs text-faint">No completed requests to break down.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {txns.map((t, i) => {
              const { total, dominant } = phaseShare(t);
              return (
                <li key={t.txnName} className="grid grid-cols-[148px_1fr] items-start gap-3" data-testid={`time-${t.txnName}`}>
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs text-fg" title={t.txnName}>{t.txnName}</div>
                    <div className="font-mono text-[11px] text-muted tnum" title={`Mean latency per request; mostly ${dominant}`}>mean {formatMs(total)}</div>
                  </div>
                  <div className="min-w-0">
                    <div style={{ width: `${max > 0 ? Math.max(4, (totals[i]! / max) * 100) : 100}%` }}><TimeBar parts={t} className="h-2.5" /></div>
                    {/* Per-row legend: what the mean is made of, in ms. */}
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5" aria-label={`${t.txnName} phases`}>
                      {TIME_PARTS.filter((p) => t[p.key] > 0).map((p) => (
                        <li key={p.key} className="flex items-center gap-1 font-mono text-[11px] text-muted tnum">
                          <span className="inline-block h-1.5 w-1.5 rounded-sm" style={{ background: p.color }} />{p.label} {formatMs(t[p.key])}
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 border-t border-line pt-2 text-[11px] text-faint">
          Queue, pool wait and database are measured with hrtime timestamps on the request path. Network and app time are the emulated delays you configured: they really held the virtual user, but they are not observations of a real network.
        </p>
      </Panel>
    </Section>
  );
}

/** Per-transaction counts and latency, with the SLO per transaction where one is set. */
export function TxnTable({ report }: { report: RunReport }) {
  const perTxn = report.design.slo.perTxn;
  return (
    <Section id="txns" title="Transactions" provenance="MEASURED" aside={`${report.txnStats.length} templates`}>
      <Table>
        <THead>
          <TR>
            <TH>Transaction</TH><TH align="right">Count</TH><TH align="right">Committed</TH><TH align="right">Rejected</TH><TH align="right">Errors</TH>
            <TH align="right">Retries</TH><TH align="right">Deadlocks</TH><TH align="right">p50</TH><TH align="right">p95</TH><TH align="right">p99</TH><TH align="right">Mean</TH>
          </TR>
        </THead>
        <TBody>
          {report.txnStats.length === 0 && <TR><TD colSpan={11} className="py-6 text-center text-faint">No transactions were recorded.</TD></TR>}
          {report.txnStats.map((t) => {
            const target = perTxn[t.txnName];
            const breach = target !== undefined && t.p95Ms > target;
            return (
              <TR key={t.txnName}>
                <TD mono className="max-w-[200px] truncate" title={t.txnName}>{t.txnName}</TD>
                <TD align="right" mono>{formatNumber(t.count)}</TD>
                <TD align="right" mono>{formatNumber(t.committed)}</TD>
                <TD align="right" mono className={cn(t.rejected > 0 && 'text-muted')}>{formatNumber(t.rejected)}</TD>
                <TD align="right" mono className={cn(t.errored > 0 && 'text-bad')}>{formatNumber(t.errored)}</TD>
                <TD align="right" mono>{formatNumber(t.retries)}</TD>
                <TD align="right" mono className={cn(t.deadlocks > 0 && 'text-warn')}>{formatNumber(t.deadlocks)}</TD>
                <TD align="right" mono>{formatMs(t.p50Ms)}</TD>
                <TD align="right" mono className={cn(breach && 'text-bad')}>
                  <span className="inline-flex items-center gap-1.5">{breach && <Pill tone="red">&gt; {formatMs(target)}</Pill>}{formatMs(t.p95Ms)}</span>
                </TD>
                <TD align="right" mono>{formatMs(t.p99Ms)}</TD>
                <TD align="right" mono>{formatMs(t.meanMs)}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </Section>
  );
}
