import { ChevronDown, CircleCheck, CircleX, Download, ExternalLink, FileText, GitCompare, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { generateDdl, type RunReport } from '@datasim/shared';
import { relativeTime, shortId } from '../../lib/format';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, HowMeasurementsWorkPopover, Pill, Tooltip, buttonClass } from '../../ui';
import { useReportActions } from './actions';
import { exportUrl } from './logic';

function saveAs(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

export function ExportMenu({ report }: { report: RunReport }) {
  const id = report.run.runId; const s = shortId(id);
  const ddl = () => {
    const url = URL.createObjectURL(new Blob([generateDdl(report.design.schema).sql], { type: 'text/plain' }));
    saveAs(url, `datasim-schema-rev${report.run.revisionNo}.sql`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonClass('secondary', 'md')} data-testid="export-menu"><Download size={14} />Export<ChevronDown size={14} className="text-faint" /></DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem icon={<FileText size={14} />} onSelect={() => saveAs(exportUrl(id, 'md'), `datasim-run-${s}.md`)}>Report (Markdown)</DropdownMenuItem>
        <DropdownMenuItem icon={<FileText size={14} />} onSelect={() => saveAs(exportUrl(id, 'samples'), `datasim-run-${s}-samples.csv`)}>Samples (CSV)</DropdownMenuItem>
        <DropdownMenuItem icon={<FileText size={14} />} onSelect={() => saveAs(exportUrl(id, 'txn'), `datasim-run-${s}-txn.csv`)}>Per-transaction stats (CSV)</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<FileText size={14} />} onSelect={ddl}>Schema DDL (.sql)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function VerdictPill({ report }: { report: RunReport }) {
  const { run, slo } = report;
  if (run.status === 'FAILED') return <Pill tone="red" className="h-6 px-2.5 text-xs font-medium" data-testid="verdict">FAILED</Pill>;
  if (run.status === 'CANCELLED') return <Pill className="h-6 px-2.5 text-xs font-medium" data-testid="verdict">CANCELLED</Pill>;
  if (!slo) return <Pill className="h-6 px-2.5 text-xs" data-testid="verdict">No verdict</Pill>;
  return slo.pass
    ? <Pill tone="green" className="h-6 px-2.5 text-xs font-medium" icon={<CircleCheck size={13} />} data-testid="verdict">PASS</Pill>
    : <Pill tone="red" className="h-6 px-2.5 text-xs font-medium" icon={<CircleX size={13} />} data-testid="verdict">FAIL</Pill>;
}

export function ReportHeader({ report }: { report: RunReport }) {
  const { run, slo } = report;
  const actions = useReportActions(report);
  const meta = [`rev ${run.revisionNo}`, run.kind, run.strategy, run.isolation, `${run.vus} VUs`, `${run.durationS} s`, run.mysqlVersion ? `MySQL ${run.mysqlVersion}` : null].filter(Boolean) as string[];
  return (
    <header className="mb-5">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted">
        <Link to="/runs" className="hover:text-fg">Runs</Link><span className="text-faint">/</span>
        <span className="font-mono">{shortId(run.runId)}</span>
        {run.startedAt && <span className="text-faint">· started {relativeTime(run.startedAt)}</span>}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-xl font-medium text-fg" data-testid="report-title">
              <Link to={`/p/${run.projectId}`} className="hover:text-accent" title="Open in Studio">{run.projectName ?? 'Project'}</Link>
            </h1>
            <VerdictPill report={report} />
            {run.invariantViolations > 0 && <Pill tone="red" className="h-6 px-2.5 text-xs" data-testid="violations-pill">{run.invariantViolations} invariant violations</Pill>}
          </div>
          <ul className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Run configuration">
            {meta.map((m) => <li key={m}><Pill mono>{m}</Pill></li>)}
          </ul>
          {slo && slo.reasons.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5 text-xs" data-testid="verdict-reasons">
              {slo.reasons.map((r) => <li key={r} className={slo.pass ? 'text-muted' : 'text-bad'}>{r}</li>)}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <HowMeasurementsWorkPopover />
          <ExportMenu report={report} />
          <Tooltip content="Compare with other runs of this project"><Link to={`/runs?projectId=${run.projectId}&select=${run.runId}`} className={buttonClass('secondary', 'md')}><GitCompare size={14} />Compare</Link></Tooltip>
          <Link to={`/p/${run.projectId}`} className={buttonClass('secondary', 'md')}><ExternalLink size={14} />Open in Studio</Link>
          <Button variant="primary" icon={<Play size={14} />} loading={actions.busy === 'rerun'} onClick={() => void actions.rerun()} data-testid="rerun">Re-run</Button>
        </div>
      </div>
    </header>
  );
}
