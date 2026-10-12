import { Check, Play, RotateCcw, Upload } from 'lucide-react';
import type { StepperScenario, StepperStateView } from '../../lib/labApi';
import { Button, Kbd, Pill, Select, cn } from '../../ui';
import { Panel } from '../lab/widgets';
import { suggestedProgress } from './logic';

const orderLabel = (a: string) => (a.startsWith('KILL_') ? `Kill ${a.slice(5)}` : a);

export function ScenarioPanel({ scenarios, selectedId, onSelect, scenario, state, busy, onLoad, onReset, next, onRunNext }: {
  scenarios: StepperScenario[]; selectedId: string; onSelect: (id: string) => void; scenario: StepperScenario | undefined;
  state: StepperStateView | null; busy: boolean; onLoad: () => void; onReset: () => void; next: string | null; onRunNext: () => void;
}) {
  const loadedId = state?.scenarioId ?? null;
  const progress = scenario && loadedId === scenario.id ? suggestedProgress(scenario.suggestedOrder, state) : 0;
  const differs = !!loadedId && loadedId !== selectedId;
  return (
    <Panel title="Scenario" subtitle="Pick a schedule, load it, then step the two transactions in any order">
      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[400px_1fr]">
        <div className="flex flex-col gap-3">
          <Select aria-label="Scenario" value={selectedId} onValueChange={onSelect} options={scenarios.map((s) => ({ value: s.id, label: s.title }))} placeholder="Loading scenarios" />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Upload size={16} />} onClick={onLoad} disabled={busy || !selectedId}>{differs || !loadedId ? 'Load scenario' : 'Reload scenario'}</Button>
            <Button icon={<RotateCcw size={16} />} onClick={onReset} disabled={busy || !loadedId}>Reset<Kbd className="ml-1">R</Kbd></Button>
          </div>
          {scenario && (
            <div className="flex flex-wrap gap-1.5">
              {scenario.syllabusRefs.map((tag) => <Pill key={tag} tone="neutral">{tag}</Pill>)}
            </div>
          )}
          <p className="text-xs text-faint">
            Keys: <Kbd>1</Kbd> run next T1 step · <Kbd>2</Kbd> run next T2 step · <Kbd>N</Kbd> run next suggested · <Kbd>R</Kbd> reset
          </p>
        </div>

        {scenario ? (
          <div className="flex min-w-0 flex-col gap-2.5">
            <p className="text-sm text-fg"><span className="text-muted">Expected outcome. </span>{scenario.expected}</p>
            <p className="text-sm text-muted">{scenario.explanation}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Suggested order</span>
              <ol className="flex flex-wrap items-center gap-1" aria-label="Suggested order">
                {scenario.suggestedOrder.map((a, i) => {
                  const done = i < progress;
                  const isNext = i === progress && !!loadedId && loadedId === scenario.id;
                  return (
                    <li key={i}>
                      <span className={cn(
                        'inline-flex h-5 items-center gap-1 rounded border px-1.5 font-mono text-[11px]',
                        done ? 'border-line text-faint' : isNext ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line bg-surface-2 text-muted',
                      )}>
                        {done && <Check size={10} />}{orderLabel(a)}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <Button size="sm" icon={<Play size={14} />} onClick={onRunNext} disabled={busy || !next || loadedId !== selectedId}>
                {next ? `Run ${orderLabel(next)}` : 'Script finished'}<Kbd className="ml-1">N</Kbd>
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Select a scenario to see what it demonstrates.</p>
        )}
      </div>
    </Panel>
  );
}
