import { Plus, Trash2 } from 'lucide-react';
import type { DesignDoc, Transaction, ValueGenerator } from '@datasim/shared';
import { useDesignStore } from '../../lib/designStore';
import { IconButton, Select } from '../../ui';
import { GEN_LABELS, PARAM_KINDS, defaultGenerator, refFor, type GenKind } from '../schema/gen';
import { GeneratorForm, SampleStrip } from '../schema/GeneratorForm';
import { uniqueName } from '../schema/logic';
import { PanelSection, TextCommit } from '../schema/widgets';
import { PARAM_NAME_RE, renameParam } from './logic';

const paramError = (taken: string[]) => (v: string) => (!PARAM_NAME_RE.test(v) ? 'Letters, digits and _; not starting with a digit' : taken.includes(v) ? 'Already used' : null);

export function ParamsTable({ design, txn }: { design: DesignDoc; txn: Transaction }) {
  const update = useDesignStore((s) => s.update);
  const mut = (fn: (t: Transaction) => void) => update((d) => { const t = d.workload.transactions.find((x) => x.name === txn.name); if (t) fn(t); });
  const names = Object.keys(txn.params);

  const add = () => mut((t) => {
    const name = uniqueName('param', Object.keys(t.params));
    const ref = refFor(design.schema);
    t.params[name] = ref ? defaultGenerator('fromTable', ref) : defaultGenerator('uniformInt');
  });

  return (
    <PanelSection title="Parameters" count={names.length} action={<IconButton size="sm" label="Add parameter" icon={<Plus size={14} />} onClick={add} />}>
      {names.length === 0 && <p className="text-xs text-faint">No parameters. Reference one in SQL as <span className="font-mono text-muted">:name</span>; each execution draws a fresh value from its generator.</p>}
      <div className="flex flex-col gap-3">
        {names.map((name) => {
          const g = txn.params[name]!;
          const kinds = PARAM_KINDS.includes(g.kind) ? PARAM_KINDS : [g.kind, ...PARAM_KINDS];
          return (
            <div key={name} className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2/40 p-2.5">
              <div className="grid grid-cols-[148px_148px_minmax(0,1fr)_28px] items-start gap-2">
                <TextCommit mono aria-label={`Parameter name ${name}`} value={name} validate={paramError(names.filter((n) => n !== name))} onCommit={(v) => mut((t) => renameParam(t, name, v))} />
                <Select
                  aria-label={`Generator for ${name}`}
                  value={g.kind}
                  options={kinds.map((k) => ({ value: k, label: GEN_LABELS[k] }))}
                  onValueChange={(k) => mut((t) => { t.params[name] = defaultGenerator(k as GenKind, refFor(design.schema)); })}
                />
                <SampleStrip className="pt-1.5" gen={g} seed={design.seed} />
                <IconButton size="sm" label={`Remove parameter ${name}`} icon={<Trash2 size={14} />} className="mt-0.5 hover:text-bad" onClick={() => mut((t) => { delete t.params[name]; })} />
              </div>
              <GeneratorForm wide value={g} schema={design.schema} onChange={(next: ValueGenerator) => mut((t) => { t.params[name] = next; })} />
            </div>
          );
        })}
      </div>
    </PanelSection>
  );
}

