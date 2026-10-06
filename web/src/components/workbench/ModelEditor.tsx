import { useState } from 'react';
import { ArrowDown, ArrowUp, Box, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui';
import { createId, newEntity, newField, type FieldType, type ModelEntity, type ModelRelation, type Scalar, type WorkspaceDefinition } from '../../lib/workspaces';

const fieldTypes: FieldType[] = ['INTEGER', 'DECIMAL', 'TEXT', 'BOOLEAN'];

function parseValue(value: string, type: FieldType): Scalar {
  if (value === '' && type !== 'TEXT') return null;
  if (type === 'INTEGER' || type === 'DECIMAL') return Number(value);
  if (type === 'BOOLEAN') return value === 'true';
  return value;
}

export function ModelEditor({ definition, onChange }: { definition: WorkspaceDefinition; onChange: (value: WorkspaceDefinition) => void }) {
  const [selectedId, setSelectedId] = useState(definition.entities[0]?.id ?? '');
  const selected = definition.entities.find((entity) => entity.id === selectedId) ?? definition.entities[0];
  const replaceEntity = (entityId: string, next: ModelEntity) => onChange({ ...definition, entities: definition.entities.map((entity) => entity.id === entityId ? next : entity) });

  function addEntity() {
    const entity = newEntity();
    onChange({ ...definition, entities: [...definition.entities, entity] });
    setSelectedId(entity.id);
  }

  function duplicateEntity(entity: ModelEntity) {
    const id = createId('table');
    const fields = entity.fields.map((field) => ({ ...field, id: createId('field') }));
    const fieldMap = new Map(entity.fields.map((field, index) => [field.id, fields[index]!.id]));
    const copy: ModelEntity = {
      ...entity,
      id,
      name: `${entity.name} copy`,
      fields,
      fixtures: entity.fixtures.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [fieldMap.get(key) ?? key, value]))),
    };
    onChange({ ...definition, entities: [...definition.entities, copy] });
    setSelectedId(copy.id);
  }

  function removeEntity(entity: ModelEntity) {
    const relations = definition.relations.filter((relation) => relation.fromEntity === entity.id || relation.toEntity === entity.id);
    const operations = definition.actors.flatMap((actor) => actor.operations.filter((operation) => 'entityId' in operation && operation.entityId === entity.id));
    const invariants = definition.invariants.filter((invariant) => invariant.entityId === entity.id);
    const dependencies = relations.length + operations.length + invariants.length;
    const detail = dependencies
      ? ` This also removes ${relations.length} relationship(s), ${operations.length} operation(s), and ${invariants.length} invariant(s) that depend on it.`
      : '';
    if (!window.confirm(`Delete table "${entity.name}"?${detail}`)) return;
    onChange({
      ...definition,
      entities: definition.entities.filter((candidate) => candidate.id !== entity.id),
      relations: relations.length ? definition.relations.filter((relation) => relation.fromEntity !== entity.id && relation.toEntity !== entity.id) : definition.relations,
      actors: definition.actors.map((actor) => ({
        ...actor, operations: actor.operations.filter((operation) => !('entityId' in operation) || operation.entityId !== entity.id),
      })),
      invariants: definition.invariants.filter((invariant) => invariant.entityId !== entity.id),
    });
    setSelectedId(definition.entities.find((candidate) => candidate.id !== entity.id)?.id ?? '');
  }

  function addField(entity: ModelEntity) {
    const field = newField();
    replaceEntity(entity.id, { ...entity, fields: [...entity.fields, field] });
  }

  function duplicateField(entity: ModelEntity, fieldId: string) {
    const source = entity.fields.find((field) => field.id === fieldId);
    if (!source) return;
    const copy = { ...source, id: createId('field'), name: `${source.name} copy`, primaryKey: false, unique: false, nullable: true };
    replaceEntity(entity.id, {
      ...entity,
      fields: [...entity.fields, copy],
      fixtures: entity.fixtures.map((row) => ({ ...row, [copy.id]: source.type === 'TEXT' ? String(row[source.id] ?? '') : source.type === 'BOOLEAN' ? false : Number(row[source.id] ?? 0) })),
    });
  }

  function removeField(entity: ModelEntity, fieldId: string) {
    const field = entity.fields.find((candidate) => candidate.id === fieldId);
    if (!field) return;
    const dependentOps = definition.actors.reduce((count, actor) => count + actor.operations.filter((operation) => {
      if (!('entityId' in operation) || operation.entityId !== entity.id) return false;
      if (operation.type === 'read' || operation.type === 'delete') return operation.keyFieldId === fieldId;
      if (operation.type === 'update') return operation.keyFieldId === fieldId || operation.changes.some((change) => change.fieldId === fieldId) ||
        Boolean(operation.guard && (operation.guard.leftFieldId === fieldId || operation.guard.rightFieldId === fieldId));
      return operation.type === 'insert' && fieldId in operation.values;
    }).length, 0);
    const dependentInvariants = definition.invariants.filter((invariant) => invariant.entityId === entity.id && (
      invariant.kind === 'row-field-nonnegative' || invariant.kind === 'row-field-equals'
        ? invariant.fieldId === fieldId
        : invariant.leftFieldId === fieldId || invariant.rightFieldId === fieldId
    )).length;
    const message = field.primaryKey
      ? 'Each table must keep exactly one primary key. Promote another field before deleting this one.'
      : `Delete field "${field.name}"? ${dependentOps} operation(s) and ${dependentInvariants} invariant(s) reference it; remove those references too?`;
    if (field.primaryKey || !window.confirm(message)) return;
    const actors = definition.actors.map((actor) => ({
      ...actor,
      operations: actor.operations.flatMap((operation) => {
        if (!('entityId' in operation) || operation.entityId !== entity.id) return [operation];
        if ((operation.type === 'read' || operation.type === 'delete') && operation.keyFieldId === fieldId) return [];
        if (operation.type === 'update') {
          if (operation.keyFieldId === fieldId) return [];
          const changes = operation.changes.filter((change) => change.fieldId !== fieldId);
          if (!changes.length || operation.guard && (operation.guard.leftFieldId === fieldId || operation.guard.rightFieldId === fieldId)) return [];
          return [{ ...operation, changes }];
        }
        if (operation.type === 'insert' && fieldId in operation.values) {
          const values = { ...operation.values };
          delete values[fieldId];
          return [{ ...operation, values }];
        }
        return [operation];
      }),
    }));
    const invariants = definition.invariants.filter((invariant) => !(invariant.entityId === entity.id && (
      invariant.kind === 'row-field-nonnegative' || invariant.kind === 'row-field-equals'
        ? invariant.fieldId === fieldId
        : invariant.leftFieldId === fieldId || invariant.rightFieldId === fieldId
    )));
    const relations = definition.relations.filter((relation) => !(
      relation.fromEntity === entity.id && relation.fromField === fieldId || relation.toEntity === entity.id && relation.toField === fieldId
    ));
    onChange({ ...definition, actors, invariants, relations, entities: definition.entities.map((candidate) => candidate.id === entity.id ? {
      ...entity, fields: entity.fields.filter((candidate) => candidate.id !== fieldId),
      fixtures: entity.fixtures.map((row) => { const copy = { ...row }; delete copy[fieldId]; return copy; }),
    } : candidate) });
  }

  const addRelation = () => {
    const from = definition.entities[0];
    const to = definition.entities[1];
    const fromField = from?.fields.find((field) => !field.primaryKey);
    const toField = to?.fields.find((field) => field.primaryKey);
    if (!from || !to || !fromField || !toField) return;
    const relation: ModelRelation = { id: createId('rel'), fromEntity: from.id, fromField: fromField.id, toEntity: to.id, toField: toField.id };
    onChange({ ...definition, relations: [...definition.relations, relation] });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[250px_minmax(0,1fr)]">
      <section className="workbench-panel">
        <div className="flex items-center justify-between gap-2 border-b border-fg/8 px-4 py-3">
          <div><p className="workbench-eyebrow">MODEL OBJECTS</p><h2 className="font-semibold">Tables / entities</h2></div>
          <Button size="sm" aria-label="Add table" onClick={addEntity}><Plus size={14} /> Add</Button>
        </div>
        <div className="space-y-1 p-2">
          {definition.entities.map((entity) => (
            <button key={entity.id} onClick={() => setSelectedId(entity.id)} aria-pressed={selected?.id === entity.id}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${selected?.id === entity.id ? 'bg-sky-400/10 text-sky-200' : 'text-stone-400 hover:bg-fg/5'}`}>
              <Box size={15} /> <span className="min-w-0 flex-1 truncate">{entity.name}</span><span className="font-mono text-[10px]">{entity.fields.length}</span>
            </button>
          ))}
          {definition.entities.length === 0 && <p className="p-3 text-sm text-stone-500">Create a table to add fields and fixtures.</p>}
        </div>
        {definition.entities.length > 1 && <div className="border-t border-fg/8 p-3"><Button size="sm" className="w-full" onClick={addRelation}><Plus size={14} /> Add relationship</Button></div>}
        {definition.relations.length > 0 && <div className="space-y-2 border-t border-fg/8 p-3">
          <p className="workbench-eyebrow">RELATIONSHIPS</p>
          {definition.relations.map((relation) => {
            const from = definition.entities.find((entity) => entity.id === relation.fromEntity);
            const to = definition.entities.find((entity) => entity.id === relation.toEntity);
            const patchRelation = (patch: Partial<ModelRelation>) => onChange({ ...definition, relations: definition.relations.map((candidate) => candidate.id === relation.id ? { ...candidate, ...patch } : candidate) });
            return <div key={relation.id} className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
              <select aria-label="Relationship source table" value={relation.fromEntity} onChange={(event) => {
                const entity = definition.entities.find((candidate) => candidate.id === event.target.value);
                if (entity) patchRelation({ fromEntity: entity.id, fromField: entity.fields[0]?.id ?? '' });
              }} className="workbench-input">{definition.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
              <select aria-label="Relationship source field" value={relation.fromField} onChange={(event) => patchRelation({ fromField: event.target.value })} className="workbench-input">{(from?.fields ?? []).map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>
              <span aria-hidden>→</span>
              <select aria-label="Relationship target table" value={relation.toEntity} onChange={(event) => {
                const entity = definition.entities.find((candidate) => candidate.id === event.target.value);
                if (entity) patchRelation({ toEntity: entity.id, toField: entity.fields[0]?.id ?? '' });
              }} className="workbench-input">{definition.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
              <select aria-label="Relationship target field" value={relation.toField} onChange={(event) => patchRelation({ toField: event.target.value })} className="workbench-input">{(to?.fields ?? []).map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>
              <button onClick={() => onChange({ ...definition, relations: definition.relations.filter((candidate) => candidate.id !== relation.id) })} aria-label="Delete relationship"><Trash2 size={13} /></button>
              <button onClick={() => onChange({ ...definition, relations: [...definition.relations, { ...relation, id: createId('rel') }] })} aria-label="Duplicate relationship"><span aria-hidden>⧉</span></button>
            </div>;
          })}
        </div>}
      </section>

      {selected ? (
        <section className="workbench-panel min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-fg/8 px-4 py-3">
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor="entity-name">Table name</label>
              <input id="entity-name" value={selected.name} onChange={(event) => replaceEntity(selected.id, { ...selected, name: event.target.value })}
                className="workbench-inline-title w-full" />
              <p className="workbench-mono">{selected.id} · {selected.fields.length} fields · {selected.fixtures.length} fixture rows</p>
            </div>
            <div className="flex gap-1">
              <Button size="sm" aria-label="Duplicate table" onClick={() => duplicateEntity(selected)}>Duplicate</Button>
              <Button size="sm" variant="danger" aria-label="Delete table" onClick={() => removeEntity(selected)}><Trash2 size={14} /></Button>
            </div>
          </div>
          <div className="space-y-5 p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between"><h3 className="workbench-eyebrow">FIELDS / KEYS / CONSTRAINTS</h3><Button size="sm" onClick={() => addField(selected)}><Plus size={13} /> Add field</Button></div>
              <div className="overflow-x-auto">
                <table className="workbench-table w-full min-w-[620px] text-left text-sm">
                  <thead><tr><th>Field</th><th>Type</th><th>Key</th><th>Nullable</th><th>Unique</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>{selected.fields.map((field) => (
                    <tr key={field.id}>
                      <td><input aria-label="Field name" value={field.name} onChange={(event) => replaceEntity(selected.id, { ...selected, fields: selected.fields.map((candidate) => candidate.id === field.id ? { ...candidate, name: event.target.value } : candidate) })} className="workbench-input w-32" /></td>
                      <td><select aria-label={`${field.name} type`} value={field.type} onChange={(event) => replaceEntity(selected.id, { ...selected, fields: selected.fields.map((candidate) => candidate.id === field.id ? { ...candidate, type: event.target.value as FieldType } : candidate) })} className="workbench-input">
                        {fieldTypes.map((type) => <option key={type}>{type}</option>)}
                      </select></td>
                      <td><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={field.primaryKey} onChange={(event) => replaceEntity(selected.id, { ...selected, fields: selected.fields.map((candidate) => candidate.id === field.id ? { ...candidate, primaryKey: event.target.checked, unique: event.target.checked, nullable: event.target.checked ? false : candidate.nullable } : event.target.checked ? { ...candidate, primaryKey: false } : candidate) })} /> PK</label></td>
                      <td><input type="checkbox" aria-label={`${field.name} nullable`} checked={field.nullable} disabled={field.primaryKey} onChange={(event) => replaceEntity(selected.id, { ...selected, fields: selected.fields.map((candidate) => candidate.id === field.id ? { ...candidate, nullable: event.target.checked } : candidate) })} /></td>
                      <td><input type="checkbox" aria-label={`${field.name} unique`} checked={field.unique} onChange={(event) => replaceEntity(selected.id, { ...selected, fields: selected.fields.map((candidate) => candidate.id === field.id ? { ...candidate, unique: event.target.checked } : candidate) })} /></td>
                      <td><div className="flex"><button aria-label={`Duplicate field ${field.name}`} onClick={() => duplicateField(selected, field.id)} className="rounded p-1 text-stone-500 hover:text-sky-200"><span aria-hidden>⧉</span></button><button aria-label={`Delete field ${field.name}`} onClick={() => removeField(selected, field.id)} className="rounded p-1 text-stone-500 hover:text-rose-300"><Trash2 size={14} /></button></div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between"><h3 className="workbench-eyebrow">FIXTURE ROWS</h3><Button size="sm" onClick={() => replaceEntity(selected.id, { ...selected, fixtures: [...selected.fixtures, Object.fromEntries(selected.fields.map((field) => [field.id, field.primaryKey && field.type === 'INTEGER' ? selected.fixtures.length + 1 : field.type === 'TEXT' ? '' : field.type === 'BOOLEAN' ? false : 0]))] })}><Plus size={13} /> Add row</Button></div>
              <div className="overflow-x-auto"><table className="workbench-table w-full min-w-[500px] text-left text-sm">
                <thead><tr>{selected.fields.map((field) => <th key={field.id}>{field.name}</th>)}<th /></tr></thead>
                <tbody>{selected.fixtures.map((row, rowIndex) => <tr key={rowIndex}>
                  {selected.fields.map((field) => <td key={field.id}>
                    {field.type === 'BOOLEAN'
                      ? <select aria-label={`${field.name} row ${rowIndex + 1}`} value={String(row[field.id] ?? false)} onChange={(event) => replaceEntity(selected.id, { ...selected, fixtures: selected.fixtures.map((candidate, index) => index === rowIndex ? { ...candidate, [field.id]: event.target.value === 'true' } : candidate) })} className="workbench-input"><option value="true">true</option><option value="false">false</option></select>
                      : <input aria-label={`${field.name} row ${rowIndex + 1}`} value={row[field.id] === null || row[field.id] === undefined ? '' : String(row[field.id])} onChange={(event) => replaceEntity(selected.id, { ...selected, fixtures: selected.fixtures.map((candidate, index) => index === rowIndex ? { ...candidate, [field.id]: parseValue(event.target.value, field.type) } : candidate) })} className="workbench-input min-w-24" />}
                  </td>)}
                  <td><div className="flex">
                    <button aria-label={`Duplicate fixture row ${rowIndex + 1}`} onClick={() => {
                      const primary = selected.fields.find((field) => field.primaryKey);
                      const copy = { ...row };
                      if (primary) {
                        const value = copy[primary.id];
                        copy[primary.id] = primary.type === 'TEXT'
                          ? `${String(value ?? '')}-copy`
                          : primary.type === 'BOOLEAN'
                            ? !Boolean(value)
                            : (typeof value === 'number' ? value : 0) + 1;
                      }
                      replaceEntity(selected.id, { ...selected, fixtures: [...selected.fixtures, copy] });
                    }} className="rounded p-1 text-stone-500 hover:text-sky-200"><span aria-hidden>⧉</span></button>
                    <button aria-label={`Delete fixture row ${rowIndex + 1}`} onClick={() => replaceEntity(selected.id, { ...selected, fixtures: selected.fixtures.filter((_candidate, index) => index !== rowIndex) })} className="rounded p-1 text-stone-500 hover:text-rose-300"><Trash2 size={14} /></button>
                  </div></td>
                </tr>)}</tbody>
              </table></div>
              {selected.fixtures.length === 0 && <p className="text-xs text-amber-300">Add a fixture row so operations have data to execute against.</p>}
            </div>
          </div>
        </section>
      ) : <div className="workbench-empty">Select or create a table to edit its schema.</div>}
    </div>
  );
}
