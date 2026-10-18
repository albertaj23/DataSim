import { AlertCircle, ArrowDown, ArrowUp, Gauge, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { validateDesign, type DesignDoc, type Problem, type QueryResponse, type Step, type TestTxnResponse, type Transaction } from '@datasim/shared';
import { useDesignStore } from '../../lib/designStore';
import { sandboxQuery, isNotProvisioned, type SandboxFailure } from '../../lib/sandbox';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, NumberField, Select, Switch, Table, TBody, TD, THead, TH, TR, Tabs, TabsList, TabsTrigger, cn, useToast } from '../../ui';
import { defaultGenerator, refFor } from '../schema/gen';
import { PanelSection, TextCommit } from '../schema/widgets';
import { LazySqlEditor } from './LazySql';
import {
  addVariant, bindsFromTest, completionSchema, inlinePlaceholders, isExplainable, missingVariants, moveItem, newStep, placeholderDiagnostics, removeVariant, sampleParams,
  scopeForStep, variantsOf, type Variant,
} from './logic';

const OPS = ['=', '!=', '<', '<=', '>', '>='].map((v) => ({ value: v, label: v }));
const ON_FAIL = [{ value: 'reject', label: 'Reject' }, { value: 'retry', label: 'Retry' }];
const BIND_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const DUPLICATED_BY_INLINE = new Set(['UNKNOWN_PARAM', 'UNKNOWN_BIND']);

interface Plan { sql: string; loading?: boolean; result?: QueryResponse; error?: SandboxFailure }

function PlanTable({ plan }: { plan: Plan }) {
  if (plan.loading) return <div className="text-xs text-muted">Running EXPLAIN</div>;
  if (plan.error) {
    return (
      <div className="flex flex-col gap-1 text-xs">
        <div className="flex items-start gap-1.5 text-bad"><AlertCircle size={13} className="mt-0.5 shrink-0" /><span className="break-words">{plan.error.message}</span></div>
        {isNotProvisioned(plan.error) && <div className="text-muted">Provision the sandbox from the Schema designer, then try again.</div>}
      </div>
    );
  }
  const r = plan.result;
  if (!r) return null;
  return (
    <div className="max-h-[220px] overflow-auto">
      <Table className="min-w-max font-mono text-xs">
        <THead><TR>{r.columns.map((c) => <TH key={c} className="px-2 text-[11px]">{c}</TH>)}</TR></THead>
        <TBody>
          {r.rows.map((row, i) => <TR key={i} className="h-7">{row.map((v, k) => <TD key={k} className="max-w-[260px] truncate px-2 text-xs" title={v == null ? 'NULL' : String(v)}>{v == null ? 'NULL' : String(v)}</TD>)}</TR>)}
        </TBody>
      </Table>
    </div>
  );
}

function StepCard({ txn, steps, index, design, mutSteps, plan, onExplain, problems }: {
  txn: Transaction; steps: Step[]; index: number; design: DesignDoc; mutSteps: (fn: (s: Step[]) => void) => void; plan: Plan | undefined; onExplain: () => void; problems: Problem[];
}) {
  const update = useDesignStore((s) => s.update);
  const step = steps[index]!;
  const scope = useMemo(() => scopeForStep(txn, steps, index, design.schema), [txn, steps, index, design.schema]);
  const cs = useMemo(() => completionSchema(design.schema), [design.schema]);
  const diagnostics = useMemo(() => placeholderDiagnostics(step.sql, scope), [step.sql, scope]);
  const unknownParams = [...new Set(diagnostics.filter((d) => d.kind === 'param').map((d) => d.name))];
  const mut = (fn: (s: Step) => void) => mutSteps((list) => { const s = list[index]; if (s) fn(s); });
  const shown = problems.filter((p) => !DUPLICATED_BY_INLINE.has(p.code));
  const livePlan = plan && plan.sql === step.sql ? plan : undefined;

  const addParam = (name: string) => update((d) => {
    const t = d.workload.transactions.find((x) => x.name === txn.name);
    const ref = refFor(d.schema);
    if (t && !(name in t.params)) t.params[name] = ref ? defaultGenerator('fromTable', ref) : defaultGenerator('uniformInt');
  });

  const enableGuard = () => mut((s) => {
    const b = scope.binds[0];
    s.guard = { left: b ? `$${b.name}.${b.columns[0] ?? 'col'}` : '1', op: '<', right: '1', onFail: 'reject' };
  });

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex h-9 items-center gap-2 border-b border-line px-2.5">
        <span className="flex h-5 min-w-5 items-center justify-center rounded bg-surface-3 px-1 font-mono text-[11px] text-muted">{index + 1}</span>
        <span className="text-xs text-muted">Save first row as</span>
        <div className="flex w-[132px] items-center gap-1">
          <span className="font-mono text-xs text-faint">$</span>
          <TextCommit cell mono placeholder="no bind" aria-label={`Bind step ${index + 1} as`} value={step.bindAs ?? ''} validate={(v) => (v === '' || BIND_RE.test(v) ? null : 'Letters, digits and _')} onCommit={(v) => mut((s) => { s.bindAs = v || undefined; })} />
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          {isExplainable(step.sql) && <Button size="sm" variant="ghost" icon={<Gauge size={14} />} loading={livePlan?.loading} onClick={onExplain}>Explain</Button>}
          <IconButton size="sm" label="Move step up" icon={<ArrowUp size={14} />} disabled={index === 0} onClick={() => mutSteps((l) => moveItem(l, index, index - 1))} />
          <IconButton size="sm" label="Move step down" icon={<ArrowDown size={14} />} disabled={index === steps.length - 1} onClick={() => mutSteps((l) => moveItem(l, index, index + 1))} />
          <IconButton size="sm" label="Delete step" icon={<Trash2 size={14} />} disabled={steps.length === 1} className="hover:text-bad" onClick={() => mutSteps((l) => { l.splice(index, 1); })} />
        </div>
      </div>

      <div className="flex flex-col gap-2 p-2.5">
        <LazySqlEditor value={step.sql} schema={cs} scope={scope} ariaLabel={`SQL of step ${index + 1}`} onCommit={(sql) => mut((s) => { s.sql = sql; })} />

        {(diagnostics.length > 0 || shown.length > 0) && (
          <ul className="flex flex-col gap-1">
            {unknownParams.map((n) => (
              <li key={n} className="flex items-center gap-2 text-xs text-bad">
                <AlertCircle size={13} className="shrink-0" />
                <span>Unknown parameter <span className="font-mono">:{n}</span></span>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" icon={<Plus size={12} />} onClick={() => addParam(n)}>Add parameter</Button>
              </li>
            ))}
            {diagnostics.filter((d) => d.kind === 'bind').map((d, i) => <li key={`b${i}`} className="flex items-center gap-2 text-xs text-bad"><AlertCircle size={13} className="shrink-0" />{d.message}</li>)}
            {shown.map((p, i) => <li key={`p${i}`} className={cn('flex items-center gap-2 text-xs', p.severity === 'error' ? 'text-bad' : 'text-warn')}><AlertCircle size={13} className="shrink-0" />{p.message}</li>)}
          </ul>
        )}

        <div className="grid grid-cols-1 gap-2 border-t border-line pt-2 text-xs">
          <div className="grid grid-cols-[124px_minmax(0,1fr)] items-center gap-2">
            <label className="flex items-center gap-2 text-muted"><Switch aria-label="Guard" checked={!!step.guard} onCheckedChange={(on) => (on ? enableGuard() : mut((s) => { s.guard = undefined; }))} />Guard</label>
            {step.guard ? (
              <div className="grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)_auto] items-center gap-1.5">
                <TextCommit mono aria-label="Guard left operand" value={step.guard.left} validate={(v) => (v.trim() ? null : 'Required')} onCommit={(v) => mut((s) => { s.guard!.left = v.trim(); })} />
                <Select size="sm" mono aria-label="Guard operator" value={step.guard.op} options={OPS} onValueChange={(op) => mut((s) => { s.guard!.op = op as never; })} />
                <TextCommit mono aria-label="Guard right operand" value={step.guard.right} validate={(v) => (v.trim() ? null : 'Required')} onCommit={(v) => mut((s) => { s.guard!.right = v.trim(); })} />
                <span className="px-1 text-faint">else reject</span>
              </div>
            ) : <span className="text-faint">Rolls back and counts a rejection when the comparison is false, e.g. <span className="font-mono">$s.enrolled &lt; $s.capacity</span>.</span>}
          </div>
          <div className="grid grid-cols-[124px_minmax(0,1fr)] items-center gap-2">
            <label className="flex items-center gap-2 text-muted"><Switch aria-label="Expect affected rows" checked={!!step.expectAffected} onCheckedChange={(on) => mut((s) => { s.expectAffected = on ? { op: '=', value: 1, onFail: 'reject' } : undefined; })} />Expect rows</label>
            {step.expectAffected ? (
              <div className="grid grid-cols-[64px_88px_112px_auto] items-center gap-1.5">
                <Select size="sm" mono aria-label="Expected rows operator" value={step.expectAffected.op} options={OPS} onValueChange={(op) => mut((s) => { s.expectAffected!.op = op as never; })} />
                <NumberField aria-label="Expected rows value" min={0} value={step.expectAffected.value} onCommit={(value) => mut((s) => { s.expectAffected!.value = value; })} />
                <Select size="sm" aria-label="On mismatch" value={step.expectAffected.onFail} options={ON_FAIL} onValueChange={(v) => mut((s) => { s.expectAffected!.onFail = v as 'reject' | 'retry'; })} />
                <span className="px-1 text-faint">on mismatch</span>
              </div>
            ) : <span className="text-faint">Checks the affected (or returned) row count, e.g. an optimistic update that must change 1 row, else retry.</span>}
          </div>
        </div>

        {livePlan && (
          <div className="border-t border-line pt-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">EXPLAIN</span>
              <span className="text-[11px] text-faint">sample values inlined</span>
            </div>
            <PlanTable plan={livePlan} />
          </div>
        )}
      </div>
    </div>
  );
}

export function StepsEditor({ design, txn, lastTest }: { design: DesignDoc; txn: Transaction; lastTest: TestTxnResponse | null }) {
  const toast = useToast();
  const update = useDesignStore((s) => s.update);
  const [variant, setVariant] = useState<Variant>('default');
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const variants = variantsOf(txn);
  const current: Variant = variants.includes(variant) ? variant : 'default';
  const steps = txn.variants[current] ?? [];
  const missing = missingVariants(txn);
  const allProblems = useMemo(() => validateDesign(design).filter((p) => p.path.txn === txn.name && p.path.variant === current), [design, txn.name, current]);

  const mutTxn = (fn: (t: Transaction) => void) => update((d) => { const t = d.workload.transactions.find((x) => x.name === txn.name); if (t) fn(t); });
  const mutSteps = (fn: (s: Step[]) => void) => mutTxn((t) => { const s = t.variants[current]; if (s) fn(s); });

  const explain = async (i: number) => {
    const s = steps[i]!;
    const key = `${current}:${i}`;
    const usable = lastTest && lastTest.txnName === txn.name && lastTest.variant === current ? lastTest : null;
    const params = usable ? usable.params : sampleParams(txn, design.seed);
    const binds = usable ? bindsFromTest(steps, usable) : {};
    setPlans((p) => ({ ...p, [key]: { sql: s.sql, loading: true } }));
    const r = await sandboxQuery(`EXPLAIN ${inlinePlaceholders(s.sql, params, binds)}`);
    setPlans((p) => ({ ...p, [key]: r.ok ? { sql: s.sql, result: r.value } : { sql: s.sql, error: r.error } }));
  };

  return (
    <PanelSection title="Steps" count={steps.length}>
      <div className="mb-3 flex items-center gap-1">
        <Tabs value={current} onValueChange={(v) => setVariant(v as Variant)} className="min-w-0 flex-1">
          <TabsList className="border-b-0">
            {variants.map((v) => <TabsTrigger key={v} value={v} className="font-mono text-xs">{v}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        {current !== 'default' && (
          <IconButton size="sm" label={`Remove variant ${current}`} icon={<X size={14} />} className="hover:text-bad" onClick={() => { mutTxn((t) => { removeVariant(t, current); }); setVariant('default'); toast.info(`Removed variant ${current}`, 'The App server falls back to default for this strategy.'); }} />
        )}
        {missing.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" icon={<Plus size={14} />}>Variant</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              {missing.map((v) => <DropdownMenuItem key={v} onSelect={() => { mutTxn((t) => addVariant(t, v)); setVariant(v); }}><span className="font-mono">{v}</span></DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <p className="mb-3 text-xs text-faint">
        {current === 'default' ? 'Used when the App server strategy has no variant of its own.' : `Used when the App server strategy is ${current}.${current === 'serializable' ? ' Runs at SERIALIZABLE isolation.' : ''} A new variant starts as a copy of default.`}
      </p>
      <div className="flex flex-col gap-3">
        {steps.map((_, i) => (
          <StepCard
            key={i}
            txn={txn}
            steps={steps}
            index={i}
            design={design}
            mutSteps={mutSteps}
            plan={plans[`${current}:${i}`]}
            onExplain={() => explain(i)}
            problems={allProblems.filter((p) => p.path.step === i)}
          />
        ))}
        <div><Button size="sm" icon={<Plus size={14} />} onClick={() => mutSteps((l) => { l.push(newStep()); })}>Add step</Button></div>
      </div>
    </PanelSection>
  );
}
