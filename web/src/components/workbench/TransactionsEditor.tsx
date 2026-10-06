import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui';
import { createId, defaultOperation, type ModelEntity, type Scalar, type WorkspaceDefinition, type WorkspaceOperation } from '../../lib/workspaces';

const operationLabels: Record<WorkspaceOperation['type'], string> = {
  read: 'Read row', update: 'Update row', insert: 'Insert row', delete: 'Delete row',
  barrier: 'Synchronization barrier', wait: 'Wait', commit: 'Commit', rollback: 'Rollback',
};

function scalarInput(value: Scalar, onChange: (value: Scalar) => void, type = 'TEXT') {
  if (type === 'BOOLEAN') return <select value={String(value ?? false)} onChange={(event) => onChange(event.target.value === 'true')} className="workbench-input"><option value="true">true</option><option value="false">false</option></select>;
  return <input value={value === null ? '' : String(value)} onChange={(event) => onChange(type === 'INTEGER' || type === 'DECIMAL' ? Number(event.target.value) : event.target.value)} className="workbench-input" />;
}

function operationEntity(definition: WorkspaceDefinition, operation: WorkspaceOperation): ModelEntity | undefined {
  return 'entityId' in operation ? definition.entities.find((entity) => entity.id === operation.entityId) : definition.entities[0];
}

export function TransactionsEditor({ definition, onChange }: { definition: WorkspaceDefinition; onChange: (value: WorkspaceDefinition) => void }) {
  const patchActor = (actorId: string, patch: { name?: string; operations?: WorkspaceOperation[] }) => onChange({
    ...definition, actors: definition.actors.map((actor) => actor.id === actorId ? { ...actor, ...patch } : actor),
  });

  function addActor() {
    if (definition.actors.length >= 8) return;
    const number = definition.actors.length + 1;
    onChange({ ...definition, actors: [...definition.actors, { id: createId('actor'), name: `Transaction ${number}`, operations: [] }] });
  }

  function duplicateActor(actorId: string) {
    if (definition.actors.length >= 8) return;
    const source = definition.actors.find((actor) => actor.id === actorId);
    if (!source) return;
    onChange({ ...definition, actors: [...definition.actors, { ...source, id: createId('actor'), name: `${source.name} copy`, operations: source.operations.map((operation) => ({ ...operation })) }] });
  }

  function reorderActor(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= definition.actors.length) return;
    const actors = [...definition.actors];
    [actors[index], actors[target]] = [actors[target]!, actors[index]!];
    onChange({ ...definition, actors });
  }

  function removeActor(actorId: string) {
    if (definition.actors.length <= 1) return;
    const actor = definition.actors.find((candidate) => candidate.id === actorId);
    if (!actor || !window.confirm(`Delete ${actor.name} and its ${actor.operations.length} operation(s)?`)) return;
    onChange({ ...definition, actors: definition.actors.filter((candidate) => candidate.id !== actorId) });
  }

  function addOperation(actorId: string) {
    const entity = definition.entities[0];
    const operation = defaultOperation('read', entity);
    patchActor(actorId, { operations: [...(definition.actors.find((actor) => actor.id === actorId)?.operations ?? []), operation] });
  }

  function changeOperation(actorId: string, index: number, next: WorkspaceOperation) {
    const actor = definition.actors.find((candidate) => candidate.id === actorId);
    if (!actor) return;
    patchActor(actorId, { operations: actor.operations.map((operation, position) => position === index ? next : operation) });
  }

  function changeType(actorId: string, index: number, type: WorkspaceOperation['type']) {
    const actor = definition.actors.find((candidate) => candidate.id === actorId);
    if (!actor) return;
    const current = actor.operations[index];
    const entity = current ? operationEntity(definition, current) : definition.entities[0];
    changeOperation(actorId, index, defaultOperation(type, entity));
  }

  function reorder(actorId: string, index: number, offset: -1 | 1) {
    const actor = definition.actors.find((candidate) => candidate.id === actorId);
    const target = index + offset;
    if (!actor || target < 0 || target >= actor.operations.length) return;
    const operations = [...actor.operations];
    [operations[index], operations[target]] = [operations[target]!, operations[index]!];
    patchActor(actorId, { operations });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="workbench-eyebrow">TRANSACTION ACTORS</p><h2 className="text-xl font-semibold">Concurrent operation lanes</h2></div>
        <Button onClick={addActor} disabled={definition.actors.length >= 8}><Plus size={14} /> Add actor ({definition.actors.length}/8)</Button>
      </div>
      {definition.actors.map((actor, actorIndex) => (
        <section key={actor.id} className="workbench-panel">
          <header className="flex flex-wrap items-center gap-2 border-b border-fg/8 px-4 py-3">
            <span className="workbench-actor-marker" aria-hidden>{String(actorIndex + 1).padStart(2, '0')}</span>
            <div className="flex gap-1">
              <button className="workbench-icon-button" aria-label={`Move ${actor.name} up`} disabled={actorIndex === 0} onClick={() => reorderActor(actorIndex, -1)}><ArrowUp size={14} /></button>
              <button className="workbench-icon-button" aria-label={`Move ${actor.name} down`} disabled={actorIndex === definition.actors.length - 1} onClick={() => reorderActor(actorIndex, 1)}><ArrowDown size={14} /></button>
            </div>
            <input aria-label="Actor name" value={actor.name} onChange={(event) => patchActor(actor.id, { name: event.target.value })} className="workbench-inline-title min-w-0 flex-1" />
            <Button size="sm" onClick={() => duplicateActor(actor.id)} disabled={definition.actors.length >= 8}>Duplicate</Button>
            <Button size="sm" variant="danger" onClick={() => removeActor(actor.id)} disabled={definition.actors.length <= 1} aria-label={`Delete ${actor.name}`}><Trash2 size={14} /></Button>
          </header>
          <ol aria-label={`${actor.name} ordered transaction operations`} className="space-y-2 p-3">
            {actor.operations.map((operation, index) => {
              const entity = operationEntity(definition, operation);
              const keyField = entity?.fields.find((field) => field.id === ('keyFieldId' in operation ? operation.keyFieldId : ''));
              const fields = entity?.fields ?? [];
              const patch = (next: WorkspaceOperation) => changeOperation(actor.id, index, next);
              return (
                <li key={`${actor.id}-${index}`} className="workbench-operation">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="workbench-step-index">{String(index + 1).padStart(2, '0')}</span>
                    <select aria-label={`Operation ${index + 1} type`} value={operation.type} onChange={(event) => changeType(actor.id, index, event.target.value as WorkspaceOperation['type'])} className="workbench-input min-w-40">
                      {Object.entries(operationLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
                    </select>
                    {('entityId' in operation) && (
                      <select aria-label={`Operation ${index + 1} table`} value={operation.entityId} onChange={(event) => {
                        const nextEntity = definition.entities.find((candidate) => candidate.id === event.target.value);
                        if (nextEntity) patch(defaultOperation(operation.type, nextEntity));
                      }} className="workbench-input min-w-32">
                        {definition.entities.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                      </select>
                    )}
                    <div className="ml-auto flex gap-1">
                      <button className="workbench-icon-button" aria-label={`Move operation ${index + 1} up`} disabled={index === 0} onClick={() => reorder(actor.id, index, -1)}><ArrowUp size={15} /></button>
                      <button className="workbench-icon-button" aria-label={`Move operation ${index + 1} down`} disabled={index === actor.operations.length - 1} onClick={() => reorder(actor.id, index, 1)}><ArrowDown size={15} /></button>
                      <button className="workbench-icon-button" aria-label={`Duplicate operation ${index + 1}`} onClick={() => {
                        const copy = operation.type === 'read' ? { ...operation, as: `${operation.as}_copy` } : { ...operation };
                        patchActor(actor.id, { operations: [...actor.operations.slice(0, index + 1), copy, ...actor.operations.slice(index + 1)] });
                      }}><span aria-hidden>+</span></button>
                      <button className="workbench-icon-button danger" aria-label={`Delete operation ${index + 1}`} onClick={() => patchActor(actor.id, { operations: actor.operations.filter((_candidate, position) => position !== index) })}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {(operation.type === 'read' || operation.type === 'update' || operation.type === 'delete') && entity && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="workbench-control">Primary key
                        <select value={operation.keyFieldId} onChange={(event) => {
                          const field = entity.fields.find((candidate) => candidate.id === event.target.value);
                          const value = field?.type === 'TEXT' ? String(operation.key) : field?.type === 'BOOLEAN' ? Boolean(operation.key) : Number(operation.key);
                          patch({ ...operation, keyFieldId: event.target.value, key: value });
                        }} className="workbench-input w-full">{entity.fields.filter((field) => field.primaryKey).map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>
                      </label>
                      <label className="workbench-control">Key value
                        {scalarInput(operation.key, (key) => patch({ ...operation, key }), keyField?.type)}
                      </label>
                      {operation.type === 'read' && <>
                        <label className="workbench-control">Save row as
                          <input value={operation.as} onChange={(event) => patch({ ...operation, as: event.target.value })} className="workbench-input w-full" />
                        </label>
                        <label className="flex items-center gap-2 self-end pb-2 text-xs text-stone-300"><input type="checkbox" checked={operation.lock} onChange={(event) => patch({ ...operation, lock: event.target.checked })} /> Lock row for update</label>
                      </>}
                      {operation.type === 'update' && <div className="sm:col-span-2 lg:col-span-4">
                        {operation.changes.map((change, changeIndex) => <div key={changeIndex} className="mt-2 grid gap-2 sm:grid-cols-3">
                          <label className="workbench-control">Field
                            <select value={change.fieldId} onChange={(event) => patch({ ...operation, changes: operation.changes.map((candidate, position) => position === changeIndex ? { ...candidate, fieldId: event.target.value } : candidate) })} className="workbench-input w-full">{fields.filter((field) => !field.primaryKey).map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>
                          </label>
                          <label className="workbench-control">Change mode
                            <select value={change.value.kind} onChange={(event) => {
                              const value = event.target.value === 'literal' ? { kind: 'literal' as const, value: 0 } : event.target.value === 'read-field' ? { kind: 'read-field' as const, variable: 'row', fieldId: 'value' } : { kind: 'increment' as const, amount: 1 };
                              patch({ ...operation, changes: operation.changes.map((candidate, position) => position === changeIndex ? { ...candidate, value } : candidate) });
                            }} className="workbench-input w-full"><option value="increment">Atomic increment</option><option value="literal">Set literal</option><option value="read-field">Write earlier read value</option></select>
                          </label>
                          <label className="workbench-control">{change.value.kind === 'increment' ? 'Amount' : change.value.kind === 'read-field' ? 'Read variable.field' : 'Value'}
                            {change.value.kind === 'increment'
                              ? <input type="number" value={change.value.amount} onChange={(event) => patch({ ...operation, changes: operation.changes.map((candidate, position) => position === changeIndex && candidate.value.kind === 'increment' ? { ...candidate, value: { ...candidate.value, amount: Number(event.target.value) } } : candidate) })} className="workbench-input w-full" />
                              : change.value.kind === 'literal'
                                ? scalarInput(change.value.value, (value) => patch({ ...operation, changes: operation.changes.map((candidate, position) => position === changeIndex && candidate.value.kind === 'literal' ? { ...candidate, value: { ...candidate.value, value } } : candidate) }))
                                : <div className="flex flex-wrap gap-1"><input aria-label="Read variable" value={change.value.variable} onChange={(event) => patch({ ...operation, changes: operation.changes.map((candidate, position) => position === changeIndex && candidate.value.kind === 'read-field' ? { ...candidate, value: { ...candidate.value, variable: event.target.value } } : candidate) })} className="workbench-input min-w-0 flex-1" /><select aria-label="Read field" value={change.value.fieldId} onChange={(event) => patch({ ...operation, changes: operation.changes.map((candidate, position) => position === changeIndex && candidate.value.kind === 'read-field' ? { ...candidate, value: { ...candidate.value, fieldId: event.target.value } } : candidate) })} className="workbench-input min-w-0 flex-1">{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select><input aria-label="Numeric offset for the read value" type="number" value={change.value.offset ?? 0} onChange={(event) => patch({ ...operation, changes: operation.changes.map((candidate, position) => position === changeIndex && candidate.value.kind === 'read-field' ? { ...candidate, value: { ...candidate.value, offset: Number(event.target.value) } } : candidate) })} className="workbench-input min-w-0 w-24" /></div>}
                          </label>
                        </div>)}
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <Button size="sm" onClick={() => patch({ ...operation, changes: [...operation.changes, { fieldId: fields.find((field) => !field.primaryKey)?.id ?? '', value: { kind: 'increment', amount: 1 } }] })}><Plus size={13} /> Add change</Button>
                          <label className="flex items-center gap-2 text-xs text-stone-300"><input type="checkbox" checked={Boolean(operation.guard)} onChange={(event) => patch({ ...operation, guard: event.target.checked ? { kind: 'field-lt-field', leftFieldId: fields.find((field) => !field.primaryKey)?.id ?? '', rightFieldId: fields.find((field) => !field.primaryKey)?.id ?? '' } : undefined })} /> Guard: left field &lt; right field</label>
                        </div>
                        {operation.guard && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-400">Only update when
                          <select aria-label="Guard left field" value={operation.guard.leftFieldId} onChange={(event) => patch({ ...operation, guard: { ...operation.guard!, leftFieldId: event.target.value } })} className="workbench-input">{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>
                          &lt;
                          <select aria-label="Guard right field" value={operation.guard.rightFieldId} onChange={(event) => patch({ ...operation, guard: { ...operation.guard!, rightFieldId: event.target.value } })} className="workbench-input">{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>
                        </div>}
                      </div>}
                    </div>
                  )}
                  {operation.type === 'insert' && entity && <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {entity.fields.map((field) => <label key={field.id} className="workbench-control">{field.name}
                      {scalarInput(operation.values[field.id] ?? null, (value) => patch({ ...operation, values: { ...operation.values, [field.id]: value } }), field.type)}
                    </label>)}
                  </div>}
                  {operation.type === 'barrier' && <label className="workbench-control mt-3">Barrier name<input value={operation.name} onChange={(event) => patch({ ...operation, name: event.target.value })} className="workbench-input w-full" /></label>}
                  {operation.type === 'wait' && <label className="workbench-control mt-3">Delay (milliseconds, 0–2000)<input type="number" min={0} max={2000} value={operation.durationMs} onChange={(event) => patch({ ...operation, durationMs: Number(event.target.value) })} className="workbench-input w-full" /></label>}
                  <p className="mt-3 text-[11px] text-stone-500">Operation order is explicit. Use the move controls to reorder without a pointer drag.</p>
                </li>
              );
            })}
            <li><Button size="sm" onClick={() => addOperation(actor.id)} disabled={definition.entities.length === 0}><Plus size={13} /> Add operation</Button></li>
          </ol>
        </section>
      ))}
    </div>
  );
}
