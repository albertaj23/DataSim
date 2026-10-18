import { AlertCircle, CheckCircle2, MinusCircle, Play } from 'lucide-react';
import type { TestTxnResponse, Transaction } from '@datasim/shared';
import { formatMs } from '../../lib/format';
import { isNotProvisioned, type SandboxFailure } from '../../lib/sandbox';
import { Button, Pill, Select, Table, TBody, TD, TH, THead, TR, cn, type Tone } from '../../ui';
import { PanelSection } from '../schema/widgets';
import { variantsOf, type Variant } from './logic';

const OUTCOME: Record<TestTxnResponse['outcome'], { tone: Tone; label: string }> = {
  COMMITTED_THEN_ROLLED_BACK: { tone: 'green', label: 'Executed, rolled back' },
  REJECTED: { tone: 'amber', label: 'Rejected' },
  ERROR: { tone: 'red', label: 'Error' },
};

const cell = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function RowsTable({ rows }: { rows: unknown[] }) {
  const objs = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
  if (objs.length === 0) return null;
  const cols = Object.keys(objs[0]!);
  const shown = objs.slice(0, 5);
  return (
    <div className="mt-2">
      <div className="max-h-[180px] overflow-auto">
        <Table className="min-w-max font-mono text-xs">
          <THead><TR>{cols.map((c) => <TH key={c} className="px-2 text-[11px]">{c}</TH>)}</TR></THead>
          <TBody>{shown.map((r, i) => <TR key={i} className="h-7">{cols.map((c) => <TD key={c} className="max-w-[160px] truncate px-2 text-xs" title={cell(r[c])}>{cell(r[c])}</TD>)}</TR>)}</TBody>
        </Table>
      </div>
      {objs.length > shown.length && <div className="mt-1 text-[11px] text-faint">Showing {shown.length} of {objs.length} returned rows</div>}
    </div>
  );
}

export function TestPanel({ txn, variant, onVariant, running, result, error, onRun, onProvision, provisioning }: {
  txn: Transaction; variant: Variant; onVariant: (v: Variant) => void; running: boolean; result: TestTxnResponse | null; error: SandboxFailure | null;
  onRun: () => void; onProvision: () => void; provisioning: boolean;
}) {
  const variants = variantsOf(txn);
  const shown = result && result.txnName === txn.name ? result : null;
  return (
    <div className="flex flex-col">
      <PanelSection title="Test once">
        <p className="mb-3 text-xs text-muted">Runs one instance on the provisioned sandbox inside a transaction, then rolls it back. Nothing is committed.</p>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Variant</span>
            <Select mono aria-label="Variant to test" value={variants.includes(variant) ? variant : 'default'} options={variants.map((v) => ({ value: v, label: v }))} onValueChange={(v) => onVariant(v as Variant)} />
          </div>
          <Button variant="primary" icon={<Play size={14} />} loading={running} onClick={onRun}>Test once</Button>
        </div>

        {error && (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-bad/30 bg-bad/5 p-2.5 text-xs">
            <div className="flex items-start gap-1.5 text-bad"><AlertCircle size={13} className="mt-0.5 shrink-0" /><span className="break-words">{error.message}</span></div>
            {isNotProvisioned(error) && (
              <div className="flex items-center gap-2">
                <span className="text-muted">Tests run against real tables, so the sandbox must exist first.</span>
                <Button size="sm" loading={provisioning} onClick={onProvision}>Provision sandbox</Button>
              </div>
            )}
          </div>
        )}
      </PanelSection>

      {shown && (
        <PanelSection title="Result">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Pill tone={OUTCOME[shown.outcome].tone}>{OUTCOME[shown.outcome].label}</Pill>
            <Pill mono>{shown.variant}</Pill>
            <span className="font-mono text-xs text-muted tnum">{formatMs(shown.steps.reduce((n, s) => n + s.ms, 0))} in DB</span>
          </div>
          {shown.message && <div className="mb-2 break-words text-xs text-muted">{shown.message}</div>}
          {Object.keys(shown.params).length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1">
              {Object.entries(shown.params).map(([k, v]) => (
                <span key={k} className="max-w-full truncate rounded border border-line bg-surface-2 px-1.5 font-mono text-[11px] leading-[18px] text-muted" title={`${k} = ${cell(v)}`}><span className="text-faint">{k}=</span>{cell(v)}</span>
              ))}
            </div>
          )}
          <ol className="flex flex-col gap-2">
            {shown.steps.map((s) => (
              <li key={s.index} className={cn('rounded-lg border bg-surface-2/40 p-2.5', s.error ? 'border-bad/40' : 'border-line')}>
                <div className="flex items-center gap-2 text-xs">
                  <span className="flex h-5 min-w-5 items-center justify-center rounded bg-surface-3 px-1 font-mono text-[11px] text-muted">{s.index + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-muted" title={s.sql}>{s.sql.replace(/\s+/g, ' ')}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs tnum">
                  <span className="text-fg">{formatMs(s.ms)}</span>
                  <span className="text-muted">{s.affected !== null ? `${s.affected} affected` : `${s.rowCount} ${s.rowCount === 1 ? 'row' : 'rows'}`}</span>
                  {s.guard && (
                    <span className={cn('inline-flex items-center gap-1', s.guard.passed ? 'text-ok' : 'text-warn')}>
                      {s.guard.passed ? <CheckCircle2 size={12} /> : <MinusCircle size={12} />}guard {s.guard.passed ? 'passed' : 'failed'}
                    </span>
                  )}
                </div>
                {s.guard && <div className="mt-1 font-mono text-[11px] text-faint">{s.guard.detail}</div>}
                {s.error && <div className="mt-2 flex items-start gap-1.5 break-words text-xs text-bad"><AlertCircle size={13} className="mt-0.5 shrink-0" />{s.error}</div>}
                <RowsTable rows={s.rows} />
              </li>
            ))}
          </ol>
        </PanelSection>
      )}
    </div>
  );
}
