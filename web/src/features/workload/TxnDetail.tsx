import { Copy, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { DesignDoc, TestTxnResponse, Transaction } from '@datasim/shared';
import { useDesignStore } from '../../lib/designStore';
import { Button, Dialog, Field, NumberField, Switch } from '../../ui';
import { identError } from '../schema/logic';
import { PanelSection, TextCommit } from '../schema/widgets';
import { deleteTransaction, duplicateTransaction, formatPct, mixPercents, renameTransaction } from './logic';
import { ParamsTable } from './ParamsTable';
import { StepsEditor } from './StepsEditor';

export function TxnDetail({ design, txn, lastTest, onRenamed, onDeleted, onDuplicated }: {
  design: DesignDoc; txn: Transaction; lastTest: TestTxnResponse | null; onRenamed: (name: string) => void; onDeleted: () => void; onDuplicated: (name: string) => void;
}) {
  const update = useDesignStore((s) => s.update);
  const [confirm, setConfirm] = useState(false);
  const txns = design.workload.transactions;
  const pct = mixPercents(txns)[txns.findIndex((t) => t.name === txn.name)] ?? 0;
  const mut = (fn: (t: Transaction) => void) => update((d) => { const t = d.workload.transactions.find((x) => x.name === txn.name); if (t) fn(t); });

  return (
    <div className="flex flex-col">
      <PanelSection
        title="Transaction"
        action={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={() => {
              const copy = duplicateTransaction(txn, txns.map((t) => t.name));
              update((d) => { d.workload.transactions.push(copy); });
              onDuplicated(copy.name);
            }}>Duplicate</Button>
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} className="hover:text-bad" onClick={() => setConfirm(true)}>Delete</Button>
          </div>
        }
      >
        <div className="grid grid-cols-[1fr_160px] gap-3">
          <Field label="Name">
            <TextCommit mono aria-label="Transaction name" value={txn.name} validate={(v) => identError(v, txns.map((t) => t.name).filter((n) => n !== txn.name))} onCommit={(v) => { update((d) => renameTransaction(d, txn.name, v)); onRenamed(v); }} />
          </Field>
          <Field label="Weight" hint={<>Share of the mix: <span className="font-mono text-muted">{formatPct(pct)}</span></>}>
            {(id) => <NumberField id={id} min={0} max={1000} value={txn.weight} onCommit={(weight) => mut((t) => { t.weight = weight; })} />}
          </Field>
        </div>
        <Field label="Description" className="mt-3">
          <TextCommit aria-label="Description" placeholder="What this transaction models" value={txn.description} onCommit={(v) => mut((t) => { t.description = v; })} />
        </Field>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm"><Switch aria-label="Read-only" checked={txn.readOnly} onCheckedChange={(readOnly) => mut((t) => { t.readOnly = readOnly; })} />Read-only<span className="text-xs text-faint">SELECT only</span></label>
          <label className="flex items-center gap-2 text-sm"><Switch aria-label="Cacheable" checked={txn.cacheable} onCheckedChange={(cacheable) => mut((t) => { t.cacheable = cacheable; })} />Cacheable<span className="text-xs text-faint">served by the Cache node</span></label>
        </div>
      </PanelSection>

      <ParamsTable design={design} txn={txn} />
      <StepsEditor key={txn.name} design={design} txn={txn} lastTest={lastTest} />

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${txn.name}?`}
        description="Its parameters, variants and steps are removed from the design. You can undo with Ctrl+Z."
        footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={() => { setConfirm(false); update((d) => deleteTransaction(d, txn.name)); onDeleted(); }}>Delete transaction</Button></>}
      >
        <p className="text-sm text-muted">{Object.keys(txn.variants).length} variant{Object.keys(txn.variants).length === 1 ? '' : 's'} and {Object.keys(txn.params).length} parameter{Object.keys(txn.params).length === 1 ? '' : 's'} will be removed.</p>
      </Dialog>
    </div>
  );
}
