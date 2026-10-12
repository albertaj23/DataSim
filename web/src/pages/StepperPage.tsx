import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pill, StatusDot, Tooltip } from '../ui';
import { PageContainer, PageHeader } from '../shell/Page';
import { LegacyNames, Notice } from '../features/lab/widgets';
import { LockTable } from '../features/stepper/LockTable';
import { ScenarioPanel } from '../features/stepper/ScenarioPanel';
import { TxnColumn } from '../features/stepper/TxnColumn';
import { InvariantPanel, WaitForGraph } from '../features/stepper/WaitForGraph';
import { canRunStep, deadlockInfo, nextSuggested } from '../features/stepper/logic';
import { useStepper } from '../features/stepper/useStepper';
import type { TxnLabel } from '../lib/labApi';

/** Transaction Stepper (Review 1): two real MySQL transactions, one statement at a time. */
export default function StepperPage() {
  const [params] = useSearchParams();
  const s = useStepper(params.get('scenario'));
  const { state, selectedId, scenarios } = s;
  const scenario = scenarios.find((x) => x.id === (state?.scenarioId ?? selectedId));
  const dead = deadlockInfo(state);
  const [showText, setShowText] = useState(false);
  const loadedMatches = !!state?.scenarioId && state.scenarioId === selectedId;
  const next = scenario && loadedMatches ? nextSuggested(scenario.suggestedOrder, state) : null;

  const runNext = useCallback(() => {
    if (!next) return;
    if (next.startsWith('KILL_')) void s.kill(next.slice(5) as TxnLabel);
    else void s.step(next as TxnLabel);
  }, [next, s]);

  // Keyboard: 1 / 2 step T1 / T2, N runs the next suggested action, R resets. Ignored while typing or with modifiers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.getAttribute('role') === 'combobox')) return;
      if (!state?.scenarioId) return;
      const k = e.key.toLowerCase();
      if (k === '1' || k === '2') {
        const label = k === '1' ? 'T1' : 'T2';
        const t = state.txns[label];
        if (canRunStep(t, t.cursor, s.busy)) { e.preventDefault(); void s.step(label); }
      } else if (k === 'n') { e.preventDefault(); runNext(); }
      else if (k === 'r' && !s.busy) { e.preventDefault(); void s.reset(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, s, runNext]);

  const live = (
    <Tooltip content={s.connected ? 'Step results arrive over Socket.IO' : 'Socket disconnected: polling the server every second'}>
      <span tabIndex={0} className="inline-flex"><Pill tone={s.connected ? 'green' : 'amber'} icon={<StatusDot status={s.connected ? 'ok' : 'warn'} />}>{s.connected ? 'live' : 'polling'}</Pill></span>
    </Tooltip>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Transaction Stepper"
        description="Step two real MySQL transactions one statement at a time. Watch the InnoDB locks, who waits for whom, and what a deadlock or a KILL does."
        actions={live}
      />
      <div className="flex flex-col gap-4">
        {s.error && <Notice>{s.error}</Notice>}
        {s.offline && !s.scenarios.length ? null : (
          <ScenarioPanel
            scenarios={s.scenarios} selectedId={s.selectedId} onSelect={s.setSelectedId} scenario={scenario} state={state}
            busy={s.busy} onLoad={() => void s.load()} onReset={() => void s.reset()} next={next} onRunNext={runNext}
          />
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {(['T1', 'T2'] as const).map((label) => (
            <TxnColumn
              key={label}
              txn={state?.txns[label] ?? { label, connId: null, isolation: null, killed: false, busy: false, steps: [], cursor: 0 }}
              pageBusy={s.busy}
              onRun={() => void s.step(label)}
              onKill={() => void s.kill(label)}
              shortcut={label === 'T1' ? '1' : '2'}
              highlightNext={next === label}
            />
          ))}
        </div>

        {dead && (
          <section role="alert" className="rounded-[10px] border border-bad/40 bg-bad/10 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-bad"><span className="font-medium">Deadlock detected.</span> InnoDB rolled back {dead.victim} (errno 1213) to break the wait-for cycle. The other transaction can continue.</p>
              {dead.text && <button type="button" onClick={() => setShowText((v) => !v)} className="text-xs text-bad underline-offset-2 hover:underline">{showText ? 'Hide' : 'Show'} SHOW ENGINE INNODB STATUS excerpt</button>}
            </div>
            {showText && dead.text && <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-xs text-fg">{dead.text}</pre>}
          </section>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <WaitForGraph waits={s.locks?.waits ?? []} lastSeen={s.lastWaits} victim={dead?.victim ?? null} />
          <InvariantPanel invariant={s.invariant} loaded={!!state?.scenarioId} />
        </div>

        <LockTable locks={s.locks} loaded={!!state?.scenarioId} />
      </div>
      <LegacyNames className="mt-6 border-t border-line pt-3" />
    </PageContainer>
  );
}

