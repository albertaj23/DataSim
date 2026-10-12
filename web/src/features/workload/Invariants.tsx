import { AlertCircle, CheckCircle2, Play, Plus, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { DesignDoc, Invariant, QueryResponse } from '@datasim/shared';
import { formatMs } from '../../lib/format';
import { useDesignStore } from '../../lib/designStore';
import { flushDraft, isNotProvisioned, sandboxQuery, useProvision, type SandboxFailure } from '../../lib/sandbox';
import { Button, Dialog, EmptyState, Field, Pill, Table, TBody, TD, TH, THead, TR, cn } from '../../ui';
import { identError, uniqueName } from '../schema/logic';
import { PanelSection, TextCommit } from '../schema/widgets';
import { LazySqlEditor } from './LazySql';
import { completionSchema, violationsOf } from './logic';

type Outcome = { invariant: string; ok: true; result: QueryResponse } | { invariant: string; ok: false; error: SandboxFailure };

const NEW_SQL = 'SELECT COUNT(*) AS violations FROM table_name WHERE 1 = 0';

export function Invariants({ design }: { design: DesignDoc }) {
  const update = useDesignStore((s) => s.update);
  const invs = design.workload.invariants;
  const [selected, setSelected] = useState<string | null>(invs[0]?.name ?? null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const prov = useProvision();
  const current = invs.find((i) => i.name === selected) ?? invs[0] ?? null;
  const cs = completionSchema(design.schema);

  const mut = (fn: (i: Invariant) => void) => update((d) => { const i = d.workload.invariants.find((x) => x.name === current?.name); if (i) fn(i); });

  const add = () => {
    const name = uniqueName('new_invariant', invs.map((i) => i.name));
    update((d) => { d.workload.invariants.push({ name, description: '', sql: NEW_SQL }); });
    setSelected(name);
  };

  const check = async () => {
    if (!current) return;
    setChecking(true);
    const f = await flushDraft();
    const r = f.ok ? await sandboxQuery(current.sql) : f;
    setChecking(false);
    setOutcome(r.ok ? { invariant: current.name, ok: true, result: r.value as QueryResponse } : { invariant: current.name, ok: false, error: r.error });
  };

  const shown = outcome && outcome.invariant === current?.name ? outcome : null;
  const violations = shown?.ok ? violationsOf(shown.result) : null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[288px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-r border-line">
        <div className="flex-1 overflow-auto py-1">
          {invs.length === 0 && <p className="px-3 py-4 text-xs text-muted">No invariants. An invariant is a SELECT returning one number, <span className="font-mono">violations</span>; 0 means the data is still correct.</p>}
          {invs.map((i) => {
            const active = i.name === current?.name;
            return (
              <button key={i.name} type="button" onClick={() => setSelected(i.name)} aria-current={active || undefined} className={cn('relative flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-surface-2', active && 'bg-surface-2')}>
                {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
                <span className="truncate font-mono text-sm">{i.name}</span>
                <span className="truncate text-xs text-muted">{i.description || 'No description'}</span>
              </button>
            );
          })}
        </div>
        <div className="border-t border-line p-3"><Button className="w-full" icon={<Plus size={14} />} onClick={add}>Add invariant</Button></div>
      </div>

      <div className="min-h-0 overflow-auto">
        {!current ? (
          <div className="p-6"><EmptyState title="No invariants" description="Invariants are checked after every run against the sandbox. They are how a lost update or overbooking becomes a number." actions={<Button variant="primary" icon={<Plus size={14} />} onClick={add}>Add invariant</Button>} /></div>
        ) : (
          <div className="mx-auto flex max-w-[860px] flex-col">
            <PanelSection title="Invariant" action={<Button size="sm" variant="ghost" icon={<Trash2 size={14} />} className="hover:text-bad" onClick={() => setConfirm(true)}>Delete</Button>}>
              <div className="grid grid-cols-[240px_1fr] gap-3">
                <Field label="Name"><TextCommit mono aria-label="Invariant name" value={current.name} validate={(v) => identError(v, invs.map((i) => i.name).filter((n) => n !== current.name))} onCommit={(v) => { mut((i) => { i.name = v; }); setSelected(v); }} /></Field>
                <Field label="Description"><TextCommit aria-label="Invariant description" placeholder="What must always hold" value={current.description} onCommit={(v) => mut((i) => { i.description = v; })} /></Field>
              </div>
            </PanelSection>

            <PanelSection title="SQL" action={<Button size="sm" variant="primary" icon={<Play size={14} />} loading={checking} onClick={check}>Check now</Button>}>
              <LazySqlEditor value={current.sql} schema={cs} scope={null} minHeight={120} ariaLabel="Invariant SQL" onCommit={(sql) => mut((i) => { i.sql = sql; })} />
              <p className="mt-2 text-xs text-faint">Must return one row with a number called <span className="font-mono">violations</span>. Runs read-only against the provisioned sandbox, so it reflects whatever data is there now.</p>
            </PanelSection>

            {(shown || prov.busy || prov.result) && (
              <PanelSection title="Result">
                {shown?.ok && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {violations === null ? <Pill tone="amber" icon={<AlertCircle size={12} />}>No violations value returned</Pill> : violations === 0 ? <Pill tone="green" icon={<CheckCircle2 size={12} />}>Pass</Pill> : <Pill tone="red" icon={<XCircle size={12} />}>Violated</Pill>}
                      {violations !== null && <span className="font-mono text-sm tnum">{violations.toLocaleString('en-US')} violations</span>}
                      <span className="font-mono text-xs text-muted tnum">{formatMs(shown.result.ms)}</span>
                    </div>
                    {violations === null && <p className="text-xs text-muted">The query must return a row with a numeric <span className="font-mono">violations</span> column.</p>}
                    <div className="max-h-[200px] overflow-auto">
                      <Table className="min-w-max font-mono text-xs">
                        <THead><TR>{shown.result.columns.map((c) => <TH key={c} className="px-2">{c}</TH>)}</TR></THead>
                        <TBody>{shown.result.rows.slice(0, 20).map((r, i) => <TR key={i} className="h-7">{r.map((v, k) => <TD key={k} className="px-2 text-xs">{v === null ? 'NULL' : String(v)}</TD>)}</TR>)}</TBody>
                      </Table>
                    </div>
                  </div>
                )}
                {shown && !shown.ok && (
                  <div className="flex flex-col gap-2 rounded-lg border border-bad/30 bg-bad/5 p-3 text-xs">
                    <div className="flex items-start gap-1.5 text-bad"><AlertCircle size={13} className="mt-0.5 shrink-0" /><span className="break-words">{shown.error.message}</span></div>
                    {isNotProvisioned(shown.error) && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted">Invariants run against real tables. Provision the sandbox, then check again.</span>
                        <Button size="sm" loading={prov.busy} onClick={async () => { await prov.run(); }}>Provision sandbox</Button>
                      </div>
                    )}
                  </div>
                )}
                {prov.busy && <p className="mt-2 text-xs text-info">Provisioning sandbox{prov.progress ? ` · ${prov.progress.doneRows.toLocaleString('en-US')} / ${prov.progress.allRows.toLocaleString('en-US')} rows` : ''}</p>}
                {prov.result && <p className="mt-2 text-xs text-ok">Sandbox ready: {prov.result.rows.toLocaleString('en-US')} rows. Check again.</p>}
              </PanelSection>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${current?.name ?? ''}?`}
        description="You can undo with Ctrl+Z."
        footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={() => { setConfirm(false); update((d) => { d.workload.invariants = d.workload.invariants.filter((i) => i.name !== current?.name); }); setSelected(null); }}>Delete invariant</Button></>}
      >
        <p className="text-sm text-muted">The check will no longer run after each load test.</p>
      </Dialog>
    </div>
  );
}
