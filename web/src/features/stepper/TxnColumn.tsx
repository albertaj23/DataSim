import { Ban, Loader2, Play } from 'lucide-react';
import type { StepResultView, StepStatus, TxnView } from '../../lib/labApi';
import { Button, IconButton, Pill, Tooltip, cn, type Tone } from '../../ui';
import { canRunStep, rowsPreview, txnPhase, type TxnPhase } from './logic';

export const TXN_TONE: Record<'T1' | 'T2', Tone> = { T1: 'accent', T2: 'blue' };

const STATUS_TONE: Record<StepStatus, Tone> = { PENDING: 'neutral', WAITING: 'amber', DONE: 'green', ERROR: 'red', KILLED: 'neutral' };
const PHASE: Record<TxnPhase, { label: string; tone: Tone }> = {
  idle: { label: 'not started', tone: 'neutral' },
  running: { label: 'open', tone: 'blue' },
  waiting: { label: 'waiting for a lock', tone: 'amber' },
  done: { label: 'finished', tone: 'green' },
  error: { label: 'error', tone: 'red' },
  killed: { label: 'killed', tone: 'neutral' },
};

function StepResult({ s }: { s: StepResultView }) {
  if (s.status === 'WAITING') {
    return <p className="text-xs text-warn">Blocked on a lock held by the other transaction. It resumes when the holder commits, rolls back or is killed (lock wait timeout 30 s).</p>;
  }
  if (s.status === 'ERROR') {
    return <p className="break-words font-mono text-xs text-bad">errno {s.errno}: {s.errorMessage}</p>;
  }
  if (s.status !== 'DONE') return null;
  const preview = rowsPreview(s.rows);
  if (preview) {
    return (
      <div className="overflow-auto rounded-md border border-line">
        <table className="w-full border-collapse font-mono text-xs">
          <thead><tr className="bg-surface-3 text-left text-faint">{preview.columns.map((c) => <th key={c} className="px-2 py-1 font-normal">{c}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {preview.cells.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="px-2 py-1 text-ok">{v}</td>)}</tr>)}
          </tbody>
        </table>
        {preview.more > 0 && <div className="border-t border-line px-2 py-1 text-xs text-faint">{preview.more} more rows</div>}
      </div>
    );
  }
  if (Array.isArray(s.rows)) return <p className="font-mono text-xs text-muted">0 rows returned</p>;
  if (s.affectedRows !== undefined) return <p className="font-mono text-xs text-ok">{s.affectedRows} {s.affectedRows === 1 ? 'row' : 'rows'} affected</p>;
  return <p className="font-mono text-xs text-ok">ok</p>;
}

export function TxnColumn({ txn, pageBusy, onRun, onKill, shortcut, highlightNext }: {
  txn: TxnView; pageBusy: boolean; onRun: () => void; onKill: () => void; shortcut: string; highlightNext: boolean;
}) {
  const phase = PHASE[txnPhase(txn)];
  const next = txn.steps[txn.cursor];
  const canStep = canRunStep(txn, txn.cursor, pageBusy);
  return (
    <section aria-label={`Transaction ${txn.label}`} className={cn('min-w-0 rounded-[10px] border bg-surface', highlightNext ? 'border-accent/40' : 'border-line')}>
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Pill tone={TXN_TONE[txn.label]} mono className="h-5 px-2 text-xs font-medium">{txn.label}</Pill>
          <Tooltip content="Isolation level is fixed by the scenario and applied when it loads.">
            <span tabIndex={0} className="inline-flex"><Pill mono>{txn.isolation ?? 'not loaded'}</Pill></span>
          </Tooltip>
          {txn.connId != null && <span className="font-mono text-xs text-faint">conn {txn.connId}</span>}
          <Pill tone={phase.tone}>{phase.label}</Pill>
        </div>
        <div className="flex items-center gap-1.5">
          <Tooltip content={next ? `Run: ${next.display}` : 'No more steps'} shortcut={shortcut}>
            <span className="inline-flex">
              <Button size="sm" variant="primary" icon={txn.busy ? <Loader2 size={14} className="ds-spin" /> : <Play size={14} />} disabled={!canStep} onClick={onRun}>
                {txn.busy ? 'Waiting' : 'Run next'}
              </Button>
            </span>
          </Tooltip>
          <Tooltip content="KILL the connection. InnoDB rolls the transaction back from the undo log.">
            <span className="inline-flex">
              <Button size="sm" variant="danger" icon={<Ban size={14} />} disabled={txn.killed || txn.connId == null || pageBusy} onClick={onKill}>Kill</Button>
            </span>
          </Tooltip>
        </div>
      </header>
      <ol className="divide-y divide-line">
        {txn.steps.map((s) => {
          const current = s.index === txn.cursor && !txn.killed && s.status === 'PENDING';
          return (
            <li key={s.index} className={cn('grid grid-cols-[20px_1fr_auto] items-start gap-x-2 gap-y-1.5 border-l-2 px-3.5 py-2.5', current ? 'border-accent bg-accent/5' : 'border-transparent')}>
              <span className="pt-px font-mono text-xs text-faint tnum">{s.index + 1}</span>
              <code className="min-w-0 break-words font-mono text-xs text-fg">{s.resolvedSql ?? s.display}</code>
              <div className="flex items-center gap-1.5">
                <Pill tone={STATUS_TONE[s.status]} className={cn(s.status === 'WAITING' && 'animate-pulse')}>{s.status}</Pill>
                <IconButton
                  label={`Run step ${s.index + 1} of ${txn.label}`}
                  size="sm"
                  variant="secondary"
                  icon={<Play size={14} />}
                  disabled={!canRunStep(txn, s.index, pageBusy)}
                  onClick={onRun}
                />
              </div>
              {s.status !== 'PENDING' && s.status !== 'KILLED' && <div className="col-start-2 col-end-4"><StepResult s={s} /></div>}
            </li>
          );
        })}
        {txn.steps.length === 0 && <li className="px-3.5 py-6 text-center text-sm text-muted">No scenario loaded.</li>}
      </ol>
    </section>
  );
}
