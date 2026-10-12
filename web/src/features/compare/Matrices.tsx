import { CircleCheck, CircleX } from 'lucide-react';
import type { RunReport, Severity } from '@datasim/shared';
import { formatNumber } from '../../lib/format';
import { Panel, Section } from '../report/Section';
import { Pill, TBody, TD, TH, THead, TR, Table, type Tone } from '../../ui';
import { diffFindings, invariantMatrix, runLetter } from './diff';

const SEV_TONE: Record<Severity, Tone> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'blue', INFO: 'neutral' };

function RunHeads({ labels }: { labels: string[] }) {
  return <>{labels.map((l, i) => <TH key={i} align="center"><span className="inline-flex items-center gap-1.5"><span className="font-mono text-faint">{runLetter(i)}</span>{l}</span></TH>)}</>;
}

/** Invariant x run matrix: violations per cell, pass/fail colour. */
export function InvariantMatrix({ runs, labels }: { runs: RunReport[]; labels: string[] }) {
  const rows = invariantMatrix(runs);
  return (
    <Section id="invariants" title="Invariants" provenance="MEASURED">
      {rows.length === 0 ? (
        <Panel className="px-4 py-8 text-center text-xs text-muted">None of these runs defined invariants.</Panel>
      ) : (
        <Table data-testid="invariant-matrix">
          <THead><TR><TH>Invariant</TH><RunHeads labels={labels} /></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.name}>
                <TD><div className="font-mono text-sm">{r.name}</div>{r.description && <div className="max-w-[420px] truncate text-[11px] text-faint" title={r.description}>{r.description}</div>}</TD>
                {r.cells.map((c, i) => (
                  <TD key={i} align="center">
                    {c === null ? <span className="text-faint">-</span> : (
                      <span className="inline-flex items-center gap-1.5">
                        <Pill tone={c.passed ? 'green' : 'red'} icon={c.passed ? <CircleCheck size={11} /> : <CircleX size={11} />}>{c.passed ? 'PASS' : 'FAIL'}</Pill>
                        <span className={c.passed ? 'font-mono text-xs text-muted tnum' : 'font-mono text-xs text-bad tnum'}>{formatNumber(c.violations)}</span>
                      </span>
                    )}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Section>
  );
}

/** Which findings exist in which run; findings that appear or disappear relative to run A are tagged. */
export function FindingsDiff({ runs, labels }: { runs: RunReport[]; labels: string[] }) {
  const rows = diffFindings(runs);
  const changed = rows.filter((r) => r.differs).length;
  return (
    <Section id="findings" title="Findings" aside={rows.length ? `${changed} differ · ${rows.length - changed} in every run` : undefined}>
      {rows.length === 0 ? (
        <Panel className="px-4 py-8 text-center text-xs text-muted">No findings in any of these runs.</Panel>
      ) : (
        <Table data-testid="findings-diff">
          <THead><TR><TH>Finding</TH><RunHeads labels={labels} /></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.key}>
                <TD className="max-w-[440px]"><div className="truncate" title={r.title}>{r.title}</div><div className="font-mono text-[11px] text-faint">{r.kind.toLowerCase()}</div></TD>
                {r.cells.map((c, i) => (
                  <TD key={i} align="center">
                    {c ? (
                      <span className="inline-flex items-center gap-1.5"><Pill tone={SEV_TONE[c]}>{c}</Pill>{r.status[i] === 'new' && <span className="text-[11px] text-warn">new</span>}</span>
                    ) : r.status[i] === 'resolved' ? <span className="text-[11px] text-ok">resolved</span> : <span className="text-faint">-</span>}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Section>
  );
}
