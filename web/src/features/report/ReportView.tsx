import { AlertTriangle, Flame } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RunReport } from '@datasim/shared';
import { Link } from 'react-router-dom';
import { Pill, buttonClass, cn } from '../../ui';
import { DbChart, ErrorsChart, LatencyChart, TpsChart } from '../charts';
import { CapacitySection } from './CapacitySection';
import { FindingsSection } from './FindingsSection';
import { InvariantsSection } from './InvariantsSection';
import { KpiStrip } from './KpiStrip';
import { LockWaits } from './LockWaits';
import { ReportHeader } from './ReportHeader';
import { Section } from './Section';
import { StatementsTable } from './StatementsTable';
import { StrategyParent, isStrategyParent } from './StrategyParent';
import { TimeWent, TxnTable } from './TimeWent';

function Callout({ tone, icon, title, children }: { tone: 'amber' | 'red'; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div role="status" className={cn('mb-4 flex items-start gap-3 rounded-lg border px-3 py-2.5', tone === 'red' ? 'border-bad/30 bg-bad/5' : 'border-warn/30 bg-warn/5')}>
      <span className={cn('mt-0.5', tone === 'red' ? 'text-bad' : 'text-warn')}>{icon}</span>
      <div className="min-w-0 text-sm"><div className="font-medium text-fg">{title}</div><div className="text-muted">{children}</div></div>
    </div>
  );
}

/** A finished (or failed) run. Sections follow the reading order: verdict, numbers, what is wrong, evidence. */
export function ReportView({ report }: { report: RunReport }) {
  if (isStrategyParent(report)) return <StrategyParent report={report} />;
  const { run } = report;
  const sloMs = report.design.slo.p95Ms;
  const hasSamples = report.samples.length > 0;
  const failed = run.status === 'FAILED';
  const cancelled = run.status === 'CANCELLED';
  const b = report.bottleneck;
  return (
    <div data-testid="report" data-run-status={run.status}>
      <ReportHeader report={report} />

      {failed && (
        <Callout tone="red" icon={<AlertTriangle size={16} />} title="This run failed">
          {(run.errorText ?? 'The run stopped with an error.').replace(/[.\s]*$/, '')}. Check the design in the Studio (Validate), then run again.{' '}
          <Link to={`/p/${run.projectId}`} className={buttonClass('secondary', 'sm', 'ml-1')}>Open in Studio</Link>
        </Callout>
      )}
      {cancelled && <Callout tone="amber" icon={<AlertTriangle size={16} />} title="This run was cancelled">Numbers cover only the time before cancellation. Invariants and findings were not evaluated.</Callout>}
      {b && !failed && (
        <Callout tone={b.severity === 'critical' ? 'red' : 'amber'} icon={<Flame size={16} />} title={`Bottleneck: ${b.kind} (${b.nodeId})`}>
          {b.reason} <Pill tone={b.severity === 'critical' ? 'red' : 'amber'} className="ml-1 align-middle">{b.severity}</Pill>
        </Callout>
      )}

      {failed ? null : run.txnTotal === 0 ? (
        <Callout tone="amber" icon={<AlertTriangle size={16} />} title="No transactions were recorded">The run ended before any request completed. Start it again, or lengthen the duration.</Callout>
      ) : (
        <div className="flex flex-col gap-6">
          <KpiStrip report={report} />
          {report.capacity && <CapacitySection report={report} capacity={report.capacity} />}
          {!cancelled && <FindingsSection report={report} />}
          {!cancelled && <InvariantsSection invariants={report.invariants} />}
          <Section id="charts" title="Time series" provenance="MEASURED" aside={report.capacity ? 'capacity steps are laid end to end' : `${report.samples.length} samples · 1 Hz`}>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <TpsChart samples={report.samples} height={200} syncId="report" emptyText={hasSamples ? undefined : 'No samples were recorded'} />
              <LatencyChart samples={report.samples} height={200} syncId="report" sloMs={sloMs} emptyText={hasSamples ? undefined : 'No samples were recorded'} />
              <ErrorsChart samples={report.samples} height={200} syncId="report" emptyText={hasSamples ? undefined : 'No samples were recorded'} />
              <DbChart samples={report.samples} height={200} syncId="report" emptyText={hasSamples ? undefined : 'No samples were recorded'} />
            </div>
          </Section>
          <TimeWent txns={report.txnStats} />
          <TxnTable report={report} />
          <StatementsTable statements={report.statementStats} />
          <LockWaits rows={report.lockWaits} />
        </div>
      )}
    </div>
  );
}
