import { AlertCircle, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import type { ProvisionProgressEvent, ProvisionResponse, Problem } from '@datasim/shared';
import { formatNumber } from '../../lib/format';
import type { SandboxFailure } from '../../lib/sandbox';
import { Button, cn } from '../../ui';

export interface ProvisionView { busy: boolean; progress: ProvisionProgressEvent | null; result: ProvisionResponse | null; error: SandboxFailure | null }

/** One-line provisioning summary, e.g. "Provisioning ok · 6 tables · 22,300 rows · 1.8 s". */
export function provisionSummary(r: ProvisionResponse): string {
  return `Provisioning ok · ${r.tables} ${r.tables === 1 ? 'table' : 'tables'} · ${formatNumber(r.rows)} rows · ${(r.ms / 1000).toFixed(1)} s`;
}

/** `compact` = a single truncated line (toolbar); otherwise the full message with a jump button. */
export function ProvisionStatus({ view, failedTable, onShowTable, compact }: { view: ProvisionView; failedTable: string | null; onShowTable: (t: string) => void; compact?: boolean }) {
  if (view.busy) {
    const p = view.progress;
    return (
      <div className="flex items-center gap-2 text-xs text-info">
        <Loader2 size={14} className="ds-spin shrink-0" />
        <span className="truncate font-mono tnum">{p ? `Provisioning sandbox · ${formatNumber(p.allRows ? p.doneRows : 0)} / ${formatNumber(p.allRows)} rows · ${p.table}` : 'Provisioning sandbox'}</span>
      </div>
    );
  }
  if (view.result) return <div className="flex items-center gap-2 text-xs text-ok"><CheckCircle2 size={14} className="shrink-0" /><span className="truncate font-mono tnum">{provisionSummary(view.result)}</span></div>;
  if (view.error && compact) {
    const text = failedTable ? `Provisioning failed on ${failedTable}` : 'Provisioning failed';
    return (
      <button type="button" disabled={!failedTable} onClick={() => failedTable && onShowTable(failedTable)} title={view.error.message} className="flex max-w-full items-center gap-2 text-xs text-bad">
        <AlertCircle size={14} className="shrink-0" /><span className="truncate font-mono">{text}</span>
      </button>
    );
  }
  if (view.error) {
    return (
      <div className="flex items-start gap-2 text-xs text-bad">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="break-words">{failedTable ? <>Failed on table <span className="font-mono">{failedTable}</span>: </> : 'Provisioning failed: '}{view.error.message}</div>
          {failedTable && <Button size="sm" variant="ghost" className="mt-1 -ml-2 text-bad" onClick={() => onShowTable(failedTable)}>Show table</Button>}
        </div>
      </div>
    );
  }
  return null;
}

export function ProblemsPanel({ problems, provision, failedTable, onSelectTable, checkedOnServer }: { problems: Problem[]; provision: ProvisionView; failedTable: string | null; onSelectTable: (t: string, column?: string) => void; checkedOnServer: boolean }) {
  const idle = !provision.busy && !provision.result && !provision.error;
  return (
    <div className="flex flex-col">
      <section className="border-b border-line px-4 py-3">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Sandbox</h3>
        {idle ? <p className="text-xs text-faint">Not provisioned in this session. Provision applies the DDL as admin and seeds every table; MySQL reports constraint and CHECK errors back to the table that caused them.</p> : <ProvisionStatus view={provision} failedTable={failedTable} onShowTable={onSelectTable} />}
      </section>
      <section className="px-4 py-3">
        <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
          Schema checks
          <span className="rounded bg-surface-3 px-1 font-mono text-[11px] normal-case tracking-normal text-muted">{problems.length}</span>
          {checkedOnServer && <span className="normal-case tracking-normal text-faint">incl. server</span>}
        </h3>
        {problems.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted"><CheckCircle2 size={14} className="text-ok" />No schema problems.</p>
        ) : (
          <ul className="flex flex-col">
            {problems.map((p, i) => {
              const Icon = p.severity === 'error' ? AlertCircle : AlertTriangle;
              const target = p.path.table;
              return (
                <li key={i}>
                  <button
                    type="button"
                    disabled={!target}
                    onClick={() => target && onSelectTable(target, p.path.column)}
                    className={cn('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors', target && 'hover:bg-surface-2')}
                  >
                    <Icon size={14} className={cn('mt-0.5 shrink-0', p.severity === 'error' ? 'text-bad' : 'text-warn')} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-fg">{p.message}</span>
                      <span className="font-mono text-[11px] text-faint">{p.code}{p.path.table ? ` · ${p.path.table}${p.path.column ? `.${p.path.column}` : ''}` : ''}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
