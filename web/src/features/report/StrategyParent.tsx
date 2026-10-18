import { GitCompare } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { RunReport } from '@datasim/shared';
import { formatMs, formatNumber, shortId } from '../../lib/format';
import { Pill, TBody, TD, TH, THead, TR, Table, buttonClass } from '../../ui';
import { VerdictPill } from './ReportHeader';

interface Child { runId: string; strategy: string; tpsAvg: number; p95Ms: number; invariantViolations: number }

/** The parent row of a "Compare strategies" batch: it has no metrics of its own, only its child runs. */
export function isStrategyParent(r: RunReport): boolean { return r.settings.kind === 'compare-strategies'; }

export function StrategyParent({ report }: { report: RunReport }) {
  const children = (Array.isArray(report.settings.children) ? report.settings.children : []) as Child[];
  const ids = children.map((c) => c.runId).slice(0, 4);
  return (
    <div data-testid="strategy-parent">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted">
        <Link to="/runs" className="hover:text-fg">Runs</Link><span className="text-faint">/</span><span className="font-mono">{shortId(report.run.runId)}</span>
      </div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-medium text-fg"><Link to={`/p/${report.run.projectId}`} className="hover:text-accent">{report.run.projectName ?? 'Project'}</Link></h1>
            <Pill tone="blue" className="h-6 px-2.5 text-xs">strategy comparison</Pill>
            {report.run.status !== 'COMPLETED' && <VerdictPill report={report} />}
          </div>
          <p className="mt-1 text-sm text-muted">One short run per strategy variant with the same seed. Open the comparison for deltas, overlaid charts and the invariant matrix.</p>
        </div>
        {ids.length >= 2 && <Link to={`/compare?ids=${ids.join(',')}`} className={buttonClass('primary', 'md')}><GitCompare size={14} />Open comparison</Link>}
      </div>
      <Table>
        <THead><TR><TH>Strategy</TH><TH align="right">TPS</TH><TH align="right">p95</TH><TH align="right">Violations</TH><TH>Run</TH></TR></THead>
        <TBody>
          {children.length === 0 && <TR><TD colSpan={5} className="py-6 text-center text-faint">No child runs were recorded.</TD></TR>}
          {children.map((c) => (
            <TR key={c.runId}>
              <TD mono>{c.strategy}</TD><TD align="right" mono>{formatNumber(c.tpsAvg)}</TD><TD align="right" mono>{formatMs(c.p95Ms)}</TD>
              <TD align="right" mono className={c.invariantViolations > 0 ? 'text-bad' : undefined}>{formatNumber(c.invariantViolations)}</TD>
              <TD><Link to={`/runs/${c.runId}`} className="font-mono text-xs text-accent hover:underline">{shortId(c.runId)}</Link></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
