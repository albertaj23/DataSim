import { Copy, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '../ui';
import { createId, type WorkspaceDefinition, type WorkspaceInvariant } from '../../lib/workspaces';

export function InvariantEditor({ definition, onChange }: { definition: WorkspaceDefinition; onChange: (value: WorkspaceDefinition) => void }) {
  function update(invariantId: string, next: WorkspaceInvariant) {
    onChange({ ...definition, invariants: definition.invariants.map((invariant) => invariant.id === invariantId ? next : invariant) });
  }

  function add(kind: WorkspaceInvariant['kind']) {
    const entity = definition.entities[0];
    const numeric = entity?.fields.filter((field) => field.type === 'INTEGER' || field.type === 'DECIMAL') ?? [];
    const base: WorkspaceInvariant = kind === 'row-field-nonnegative'
      ? { id: createId('check'), description: 'This field must remain nonnegative.', kind, entityId: entity?.id ?? '', fieldId: numeric[0]?.id ?? '' }
      : kind === 'row-field-equals'
        ? { id: createId('check'), description: 'This field must equal the expected value.', kind, entityId: entity?.id ?? '', fieldId: numeric[0]?.id ?? '', value: 0 }
        : { id: createId('check'), description: 'The left value must not exceed the right value.', kind, entityId: entity?.id ?? '', leftFieldId: numeric[0]?.id ?? '', rightFieldId: numeric[1]?.id ?? numeric[0]?.id ?? '' };
    onChange({ ...definition, invariants: [...definition.invariants, base] });
  }

  return (
    <section className="workbench-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-fg/8 px-4 py-3">
        <div><p className="workbench-eyebrow">ASSERTION / POSTCONDITION</p><h2 className="text-lg font-semibold">Invariants</h2></div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => add('row-field-nonnegative')} disabled={!definition.entities.length}><Plus size={13} /> Field ≥ 0</Button>
          <Button size="sm" onClick={() => add('row-field-equals')} disabled={!definition.entities.length}><Plus size={13} /> Field = value</Button>
          <Button size="sm" onClick={() => add('row-field-lte')} disabled={!definition.entities.length}><Plus size={13} /> Field ≤ field</Button>
        </div>
      </header>
      <div className="space-y-3 p-4">
        {definition.invariants.map((invariant) => {
          const entity = definition.entities.find((candidate) => candidate.id === invariant.entityId);
          const fieldLabel = (fieldId: string) => entity?.fields.find((field) => field.id === fieldId)?.name ?? 'Choose field';
          return (
            <article key={invariant.id} className="workbench-invariant">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-1 shrink-0 text-emerald-300" size={17} />
                <div className="min-w-0 flex-1 space-y-3">
                  <label className="workbench-control">Plain-language property
                    <input value={invariant.description} onChange={(event) => update(invariant.id, { ...invariant, description: event.target.value })} className="workbench-input w-full" />
                  </label>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
                    <span>Structured check · every row in</span>
                    <select value={invariant.entityId} onChange={(event) => {
                      const nextEntity = definition.entities.find((candidate) => candidate.id === event.target.value);
                      if (!nextEntity) return;
                      const numeric = nextEntity.fields.find((field) => field.type === 'INTEGER' || field.type === 'DECIMAL')?.id ?? '';
                      update(invariant.id, invariant.kind === 'row-field-nonnegative' || invariant.kind === 'row-field-equals'
                        ? { ...invariant, entityId: nextEntity.id, fieldId: numeric }
                        : { ...invariant, entityId: nextEntity.id, leftFieldId: numeric, rightFieldId: numeric });
                    }} className="workbench-input">{definition.entities.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select>
                    {invariant.kind === 'row-field-nonnegative' || invariant.kind === 'row-field-equals' ? <>
                      <select aria-label="Invariant field" value={invariant.fieldId} onChange={(event) => update(invariant.id, { ...invariant, fieldId: event.target.value })} className="workbench-input">{(entity?.fields ?? []).map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>
                      {invariant.kind === 'row-field-nonnegative'
                        ? <code className="workbench-expression">{fieldLabel(invariant.fieldId)} ≥ 0</code>
                        : <>
                          <span>=</span>
                          <input aria-label="Invariant expected value" type="number" value={invariant.value} onChange={(event) => update(invariant.id, { ...invariant, value: Number(event.target.value) })} className="workbench-input w-24" />
                          <code className="workbench-expression">{fieldLabel(invariant.fieldId)} = {invariant.value}</code>
                        </>}
                    </> : <>
                      <select aria-label="Invariant left field" value={invariant.leftFieldId} onChange={(event) => update(invariant.id, { ...invariant, leftFieldId: event.target.value })} className="workbench-input">{(entity?.fields ?? []).map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>
                      <span>≤</span>
                      <select aria-label="Invariant right field" value={invariant.rightFieldId} onChange={(event) => update(invariant.id, { ...invariant, rightFieldId: event.target.value })} className="workbench-input">{(entity?.fields ?? []).map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>
                      <code className="workbench-expression">{fieldLabel(invariant.leftFieldId)} ≤ {fieldLabel(invariant.rightFieldId)}</code>
                    </>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button className="workbench-icon-button" aria-label={`Duplicate invariant ${invariant.description}`} onClick={() => onChange({ ...definition, invariants: [...definition.invariants, { ...invariant, id: createId('check'), description: `${invariant.description} copy` }] })}><Copy size={14} /></button>
                  <button className="workbench-icon-button danger" aria-label={`Delete invariant ${invariant.description}`} onClick={() => onChange({ ...definition, invariants: definition.invariants.filter((candidate) => candidate.id !== invariant.id) })}><Trash2 size={15} /></button>
                </div>
              </div>
            </article>
          );
        })}
        {!definition.invariants.length && <div className="workbench-empty"><ShieldCheck size={26} /><p>Define at least one structured property before a run can start.</p></div>}
      </div>
      <p className="border-t border-fg/8 px-4 py-3 text-xs text-stone-500">The backend validates table/field references and evaluates only supported, typed predicates. Plain-language text is descriptive; it is never executed.</p>
    </section>
  );
}
