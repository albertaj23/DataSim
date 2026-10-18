import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { strategyFor, type TestTxnResponse } from '@datasim/shared';
import { useDesignStore } from '../../lib/designStore';
import { testTransaction, useProvision, type SandboxFailure } from '../../lib/sandbox';
import { Button, EmptyState, Overlay, Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui';
import type { EditorOverlayProps } from '../schema';
import { Invariants } from './Invariants';
import { newTransaction, normalizeWeights, type Variant } from './logic';
import { TestPanel } from './TestPanel';
import { TxnDetail } from './TxnDetail';
import { TxnList } from './TxnList';

function Editor() {
  const design = useDesignStore((s) => s.design);
  const update = useDesignStore((s) => s.update);
  const txns = design.workload.transactions;
  const [selected, setSelected] = useState<string | null>(txns[0]?.name ?? null);
  const [tab, setTab] = useState<'transactions' | 'invariants'>('transactions');
  const [testVariant, setTestVariant] = useState<Variant | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestTxnResponse | null>(null);
  const [error, setError] = useState<SandboxFailure | null>(null);
  const prov = useProvision();

  const txn = txns.find((t) => t.name === selected) ?? txns[0] ?? null;
  useEffect(() => { if (txn && txn.name !== selected) setSelected(txn.name); if (!txn && selected) setSelected(null); }, [txn, selected]);

  // Test the variant the App server would pick unless the user chose another one.
  const appStrategy = useMemo(() => design.nodes.find((n) => n.type === 'app'), [design.nodes]);
  const defaultVariant = txn ? (strategyFor(txn, appStrategy?.type === 'app' ? appStrategy.config.strategy : 'default') as Variant) : 'default';
  const variant = testVariant && txn && testVariant in txn.variants ? testVariant : defaultVariant;

  const run = async () => {
    if (!txn) return;
    setRunning(true); setError(null);
    const r = await testTransaction({ txnName: txn.name, variant });
    setRunning(false);
    if (r.ok) { setResult(r.value); } else { setResult(null); setError(r.error); }
  };

  const provisionThenRun = async () => {
    const r = await prov.run();
    if (r.ok) await run();
  };

  const add = () => {
    const t = newTransaction(design);
    update((d) => { d.workload.transactions.push(t); });
    setSelected(t.name); setTab('transactions');
  };

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0 px-3">
        <TabsTrigger value="transactions" count={txns.length}>Transactions</TabsTrigger>
        <TabsTrigger value="invariants" count={design.workload.invariants.length}>Invariants</TabsTrigger>
      </TabsList>

      <TabsContent value="transactions" className="min-h-0 flex-1">
        <div className="grid h-full min-h-0 grid-cols-[288px_minmax(0,1fr)_400px]">
          <div className="min-h-0 border-r border-line bg-surface">
            <TxnList txns={txns} selected={txn?.name ?? null} onSelect={(n) => { setSelected(n); setError(null); }} onAdd={add} onNormalize={() => update((d) => normalizeWeights(d.workload.transactions))} />
          </div>
          <div className="min-h-0 overflow-auto">
            {txn ? (
              <div className="mx-auto max-w-[860px]"><TxnDetail design={design} txn={txn} lastTest={result} onRenamed={setSelected} onDeleted={() => setSelected(null)} onDuplicated={setSelected} /></div>
            ) : (
              <div className="p-6"><EmptyState title="No transactions" description="Add a transaction to describe what virtual users do: its parameters, SQL steps and how often it runs." actions={<Button variant="primary" icon={<Plus size={14} />} onClick={add}>Add transaction</Button>} /></div>
            )}
          </div>
          <aside className="min-h-0 overflow-auto border-l border-line bg-surface" aria-label="Test once">
            {txn ? (
              <TestPanel txn={txn} variant={variant} onVariant={setTestVariant} running={running} result={result} error={error} onRun={run} onProvision={provisionThenRun} provisioning={prov.busy} />
            ) : null}
          </aside>
        </div>
      </TabsContent>

      <TabsContent value="invariants" className="min-h-0 flex-1">
        <Invariants design={design} />
      </TabsContent>
    </Tabs>
  );
}

export function WorkloadEditor({ open, onClose }: EditorOverlayProps) {
  return (
    <Overlay open={open} onClose={onClose} title="Workload editor">
      <Editor />
    </Overlay>
  );
}
