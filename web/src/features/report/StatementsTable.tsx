import { ScanSearch } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { StatementStat } from '@datasim/shared';
import { formatMs, formatNumber } from '../../lib/format';
import { Button, CodeBlock, Pill, TBody, TD, TH, THead, TR, Table, Tooltip, cn } from '../../ui';
import { explainTables, isFullScan } from './logic';
import { Drawer, Panel, Section } from './Section';

const PREVIEW = 12;

function ExplainDrawer({ stmt, onClose }: { stmt: StatementStat | null; onClose: () => void }) {
  const plan = useMemo(() => (stmt?.explain ? explainTables(stmt.explain) : []), [stmt]);
  const json = useMemo(() => (stmt?.explain ? JSON.stringify(stmt.explain, null, 2) : ''), [stmt]);
  return (
    <Drawer open={!!stmt} onOpenChange={(o) => { if (!o) onClose(); }} title="EXPLAIN" description={stmt ? `${stmt.txnName ?? 'unattributed'} · ${formatNumber(stmt.execCount)} executions · measured digest, EXPLAIN FORMAT=JSON with sample parameters` : undefined} width={620}>
      {stmt && (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1 text-xs text-muted">Statement digest</div>
            <CodeBlock code={stmt.digestText} maxHeight={160} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              ['Avg', formatMs(stmt.avgMs)], ['Max', formatMs(stmt.maxMs)],
              ['Rows examined', formatNumber(stmt.rowsExamined)], ['Rows sent', formatNumber(stmt.rowsSent)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-surface-2 px-2.5 py-2">
                <div className="text-[11px] text-muted">{k}</div>
                <div className="font-mono text-sm tnum">{v}</div>
              </div>
            ))}
          </div>
          {stmt.explain == null ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">No EXPLAIN is available for this statement. DataSim explains each workload statement once with sample parameters; internal statements such as COMMIT have no plan.</p>
          ) : (
            <>
              {plan.length > 0 && (
                <div>
                  <div className="mb-1 text-xs text-muted">Access path</div>
                  <Table>
                    <THead><TR><TH>Table</TH><TH>Access</TH><TH>Key</TH><TH align="right">Rows</TH><TH align="right">Filtered</TH></TR></THead>
                    <TBody>
                      {plan.map((t, i) => (
                        <TR key={`${t.table}-${i}`}>
                          <TD mono>{t.table}</TD>
                          <TD mono><span className={cn(isFullScan(t) && 'text-bad')}>{t.access ?? '-'}</span>{isFullScan(t) && <Pill tone="red" className="ml-1.5">full scan</Pill>}</TD>
                          <TD mono className="text-muted">{t.key ?? 'none'}</TD>
                          <TD align="right" mono>{t.rows == null ? '-' : formatNumber(t.rows)}</TD>
                          <TD align="right" mono>{t.filtered ? `${t.filtered}%` : '-'}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
              <div>
                <div className="mb-1 text-xs text-muted">EXPLAIN FORMAT=JSON</div>
                <CodeBlock code={json} maxHeight={420} />
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** performance_schema digests for the measured window, heaviest (avg x count) first. */
export function StatementsTable({ statements }: { statements: StatementStat[] }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<StatementStat | null>(null);
  const rows = all ? statements : statements.slice(0, PREVIEW);
  return (
    <Section id="statements" title="Statements" provenance="MEASURED" aside={`${statements.length} digests · sorted by total time`}>
      {statements.length === 0 ? (
        <Panel className="px-4 py-8 text-center text-xs text-muted">No statement digests were collected for this run.</Panel>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Statement</TH><TH>Transaction</TH><TH align="right">Executions</TH><TH align="right">Avg</TH><TH align="right">Max</TH>
                <TH align="right">Rows examined</TH><TH align="right">Lock time (total)</TH><TH>Index</TH><TH><span className="sr-only">EXPLAIN</span></TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((s) => (
                <TR key={s.digest} interactive onClick={() => setOpen(s)} data-testid="statement-row">
                  <TD className="max-w-[360px]">
                    <Tooltip content={<span className="block max-w-[420px] break-words font-mono text-[11px]">{s.digestText}</span>}>
                      <span className="block truncate font-mono text-xs">{s.digestText}</span>
                    </Tooltip>
                  </TD>
                  <TD mono className="text-muted">{s.txnName ?? '-'}</TD>
                  <TD align="right" mono>{formatNumber(s.execCount)}</TD>
                  <TD align="right" mono>{formatMs(s.avgMs)}</TD>
                  <TD align="right" mono>{formatMs(s.maxMs)}</TD>
                  <TD align="right" mono>{formatNumber(s.rowsExamined)}</TD>
                  <TD align="right" mono>{formatMs(s.lockTimeMs)}</TD>
                  <TD>{s.noIndexUsed > 0 ? <Pill tone="amber">no index</Pill> : <span className="text-faint">-</span>}</TD>
                  <TD align="right"><Button size="sm" variant="ghost" icon={<ScanSearch size={14} />} aria-label="Show EXPLAIN" onClick={(e) => { e.stopPropagation(); setOpen(s); }}>Explain</Button></TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {statements.length > PREVIEW && (
            <div className="mt-2"><Button size="sm" variant="ghost" onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all ${statements.length}`}</Button></div>
          )}
        </>
      )}
      <ExplainDrawer stmt={open} onClose={() => setOpen(null)} />
    </Section>
  );
}
