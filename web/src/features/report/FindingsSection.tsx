import { CircleCheck, ExternalLink, Play, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Finding, RunReport, Severity } from '@datasim/shared';
import { Button, CodeBlock, Pill, buttonClass, type Tone } from '../../ui';
import { useReportActions } from './actions';
import { evidenceChips } from './logic';
import { Panel, Section } from './Section';

const TONE: Record<Severity, Tone> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'blue', INFO: 'neutral' };

function FindingCard({ f, report, applied, onApplied, actions }: {
  f: Finding; report: RunReport; applied: number | undefined; onApplied: (rev: number) => void; actions: ReturnType<typeof useReportActions>;
}) {
  const [showSql, setShowSql] = useState(false);
  const chips = evidenceChips(f.evidence);
  const statement = typeof f.evidence.statement === 'string' ? f.evidence.statement : null;
  const label = f.fixLabel ?? (f.fix ? f.fix.type : '');
  return (
    <article className="flex flex-col gap-2 px-4 py-3" data-testid={`finding-${f.findingNo}`} data-kind={f.kind}>
      <div className="flex items-center gap-2">
        <Pill tone={TONE[f.severity]} className="font-medium">{f.severity}</Pill>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-fg" title={f.title}>{f.title}</h3>
        <span className="shrink-0 font-mono text-[11px] text-faint">{f.kind.toLowerCase()}</span>
      </div>
      <p className="max-w-[900px] text-xs leading-[18px] text-muted">{f.explanation}</p>
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Evidence">
          {chips.map((c) => (
            <li key={c.label} className="inline-flex h-[20px] max-w-full items-center gap-1.5 rounded-md border border-line bg-surface-2 px-1.5 text-[11px]">
              <span className="text-faint">{c.label}</span><span className="truncate font-mono text-fg tnum">{c.value}</span>
            </li>
          ))}
        </ul>
      )}
      {statement && (
        <div>
          <button type="button" onClick={() => setShowSql((s) => !s)} className="text-[11px] text-muted underline-offset-2 hover:text-fg hover:underline">{showSql ? 'Hide statement' : 'Show statement'}</button>
          {showSql && <div className="mt-1.5"><CodeBlock code={statement} maxHeight={200} /></div>}
        </div>
      )}
      {f.fix && (
        <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
          {applied === undefined ? (
            <>
              <Button size="sm" variant="primary" icon={<Wrench size={14} />} loading={actions.busy === 'fix'} disabled={actions.busy !== null} onClick={async () => { const rev = await actions.applyFix(f.fix!, label); if (rev !== null) onApplied(rev); }}>Apply fix</Button>
              <span className="text-xs text-muted">{label}</span>
              <span className="text-[11px] text-faint">creates a new revision; the draft is updated</span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs text-ok"><CircleCheck size={14} />Applied · rev {applied}</span>
              <Button size="sm" variant="secondary" icon={<Play size={14} />} loading={actions.busy === 'rerun'} disabled={actions.busy !== null} onClick={() => void actions.rerun(f.fix)}>Re-run</Button>
              <Link to={`/p/${report.run.projectId}`} className={buttonClass('ghost', 'sm')}><ExternalLink size={14} />Open in Studio</Link>
            </>
          )}
        </div>
      )}
    </article>
  );
}

/** Advisor findings, highest severity first. Informational ones fold away. Fixes post to apply-fix and offer a re-run. */
export function FindingsSection({ report }: { report: RunReport }) {
  const actions = useReportActions(report);
  const [applied, setApplied] = useState<Record<number, number>>({});
  const [showInfo, setShowInfo] = useState(false);
  const main = report.findings.filter((f) => f.severity !== 'INFO');
  const info = report.findings.filter((f) => f.severity === 'INFO');
  const shown = showInfo ? [...main, ...info] : main;
  const card = (f: Finding) => <FindingCard key={f.findingNo} f={f} report={report} applied={applied[f.findingNo]} onApplied={(rev) => setApplied((a) => ({ ...a, [f.findingNo]: rev }))} actions={actions} />;
  return (
    <Section id="findings" title="Findings" aside={report.findings.length ? `${main.length} to review · ${info.length} informational` : undefined}>
      {report.findings.length === 0 ? (
        <Panel className="px-4 py-8 text-center text-xs text-muted">The advisor found nothing to flag for this run.</Panel>
      ) : (
        <Panel>
          <div className="divide-y divide-line">{shown.map(card)}</div>
          {info.length > 0 && (
            <div className="border-t border-line px-4 py-2">
              <Button size="sm" variant="ghost" onClick={() => setShowInfo((s) => !s)}>{showInfo ? 'Hide informational findings' : `Show ${info.length} informational finding${info.length === 1 ? '' : 's'}`}</Button>
            </div>
          )}
        </Panel>
      )}
    </Section>
  );
}
