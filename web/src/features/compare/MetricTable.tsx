import type { RunReport } from '@datasim/shared';
import { Section } from '../report/Section';
import { TBody, TD, TH, THead, TR, Table, cn } from '../../ui';
import { METRICS, compareValue, formatDelta, formatMetric, runLetter, type Verdict } from './diff';

const LABEL_W = 200;
const RUN_W = 200;
const DELTA_TONE: Record<Verdict, string> = { better: 'text-ok', worse: 'text-bad', same: 'text-faint', none: 'text-faint' };

/** One row per metric, one column per run; every run after the first shows its delta against run A (green better, red worse). */
export function MetricTable({ runs, labels }: { runs: RunReport[]; labels: string[] }) {
  return (
    <Section id="metrics" title="Metrics" provenance="MEASURED" aside="deltas are against run A · green better, red worse">
      {/* Fixed column widths so two runs do not spread label and values across the whole page. */}
      <div className="w-fit max-w-full">
      <Table data-testid="metric-table" className="table-fixed" style={{ width: LABEL_W + runs.length * RUN_W, maxWidth: '100%' }}>
        <colgroup><col style={{ width: LABEL_W }} />{runs.map((r) => <col key={r.run.runId} style={{ width: RUN_W }} />)}</colgroup>
        <THead>
          <TR>
            <TH>Metric</TH>
            {runs.map((r, i) => (
              <TH key={r.run.runId} align="right" className="whitespace-normal py-1 leading-tight"><span className="inline-flex items-center gap-1.5"><span className="font-mono text-faint">{runLetter(i)}</span>{labels[i]}</span></TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {METRICS.map((m) => {
            const vals = runs.map((r) => m.get(r));
            if (vals.every((v) => v == null)) return null;
            return (
              <TR key={m.key} data-testid={`metric-${m.key}`}>
                <TD className="text-muted">{m.label}</TD>
                {vals.map((v, i) => {
                  const d = i === 0 ? null : compareValue(vals[0] ?? null, v, m.direction);
                  return (
                    <TD key={runs[i]!.run.runId} align="right">
                      <span className="inline-flex items-baseline justify-end gap-2.5">
                        <span className="font-mono tnum">{formatMetric(m.unit, v)}</span>
                        <span className={cn('inline-block w-[56px] text-left font-mono text-xs tnum', d ? DELTA_TONE[d.verdict] : 'text-transparent')} data-verdict={d?.verdict} aria-label={d ? `${d.verdict} than run A` : undefined}>{d ? formatDelta(d, m.unit) : '-'}</span>
                      </span>
                    </TD>
                  );
                })}
              </TR>
            );
          })}
        </TBody>
      </Table>
      </div>
    </Section>
  );
}

