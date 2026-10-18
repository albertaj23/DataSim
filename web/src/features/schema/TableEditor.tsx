import { AlertCircle, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { COLUMN_KINDS, type Column, type ColumnType, type DesignDoc, type Problem, type Table } from '@datasim/shared';
import { useDesignStore } from '../../lib/designStore';
import { Button, Dialog, Field, IconButton, NumberField, Select, Switch, useToast, cn } from '../../ui';
import { GEN_LABELS, SEED_KINDS, defaultGenerator, inferredSeedLabel, refFor, type GenKind } from './gen';
import { GeneratorForm, SampleStrip } from './GeneratorForm';
import {
  deleteColumn, deleteTable, formatDefault, identError, isIntKind, isUniqueCol, newColumn, newForeignKey, parseDefault, renameColumn, renameTable,
  setColumnKind, sqlMentions, toggleAutoIncrement, togglePk, toggleUnique, uniqueName, type Kind,
} from './logic';
import { ColumnPicker, FlagToggle, PanelSection, TextCommit } from './widgets';

const KIND_OPTIONS = COLUMN_KINDS.map((k) => ({ value: k, label: k }));
const ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'].map((v) => ({ value: v, label: v }));
const SEED_OPTIONS = [{ value: 'auto', label: 'Auto (inferred)' }, ...SEED_KINDS.map((k) => ({ value: k, label: GEN_LABELS[k] }))];

type Mutate = (fn: (t: Table, d: DesignDoc) => void) => void;

function useMutate(tableName: string): Mutate {
  const update = useDesignStore((s) => s.update);
  return (fn) => update((d) => { const t = d.schema.tables.find((x) => x.name === tableName); if (t) fn(t, d); });
}

const optionalName = (taken: string[]) => (v: string) => (v === '' ? null : identError(v, taken));

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <IconButton size="sm" label={label} icon={<Plus size={14} />} onClick={onClick} />;
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <IconButton size="sm" label={label} icon={<Trash2 size={14} />} onClick={onClick} className="hover:text-bad" />;
}

// ---------------------------------------------------------------- column type parameters
function TypeParams({ type, onChange }: { type: ColumnType; onChange: (t: ColumnType) => void }) {
  if (isIntKind(type.kind)) {
    const t = type as Extract<ColumnType, { unsigned: boolean }>;
    return (
      <label className="col-span-2 flex items-center gap-2 text-xs text-muted">
        <Switch aria-label="Unsigned" checked={t.unsigned} onCheckedChange={(unsigned) => onChange({ ...t, unsigned })} />Unsigned
      </label>
    );
  }
  if (type.kind === 'DECIMAL') {
    return (
      <>
        <Field label="Precision">{(id) => <NumberField id={id} min={1} max={38} value={type.precision} onCommit={(precision) => onChange({ ...type, precision, scale: Math.min(type.scale, precision) })} />}</Field>
        <Field label="Scale">{(id) => <NumberField id={id} min={0} max={Math.min(30, type.precision)} value={type.scale} onCommit={(scale) => onChange({ ...type, scale })} />}</Field>
      </>
    );
  }
  if (type.kind === 'CHAR' || type.kind === 'VARCHAR') {
    return <Field label="Length">{(id) => <NumberField id={id} min={1} max={type.kind === 'CHAR' ? 255 : 4000} value={type.length} onCommit={(length) => onChange({ ...type, length })} />}</Field>;
  }
  if (type.kind === 'ENUM') {
    const values = type;
    return (
      <Field label="Values (comma separated)" className="col-span-2">
        <TextCommit
          mono
          value={values.values.join(', ')}
          validate={(t) => { const v = t.split(',').map((s) => s.trim()).filter(Boolean); return v.length === 0 ? 'At least one value' : new Set(v).size !== v.length ? 'Values must be distinct' : null; }}
          onCommit={(t) => onChange({ kind: 'ENUM', values: t.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
      </Field>
    );
  }
  return null;
}

// ---------------------------------------------------------------- one column
function ColumnRow({ table, column, open, onToggle, problems, mutate, schemaSeed }: { table: Table; column: Column; open: boolean; onToggle: () => void; problems: Problem[]; mutate: Mutate; schemaSeed: number }) {
  const toast = useToast();
  const design = useDesignStore((s) => s.design);
  const update = useDesignStore((s) => s.update);
  const c = column;
  const pk = table.primaryKey.includes(c.name);
  const mutCol = (fn: (col: Column, t: Table) => void) => mutate((t) => { const x = t.columns.find((y) => y.name === c.name); if (x) fn(x, t); });
  const taken = table.columns.map((x) => x.name).filter((n) => n !== c.name);
  const seedKind = c.seed?.kind ?? 'auto';
  const seeded = !c.generated && !c.autoIncrement;
  const siblings = table.columns.filter((x) => x.name !== c.name).map((x) => x.name);

  const rename = (to: string) => {
    const mentions = sqlMentions(design, c.name);
    update((d) => renameColumn(d, table.name, c.name, to));
    if (mentions > 0) toast.info(`Renamed ${c.name} to ${to}`, `${mentions} workload statement${mentions === 1 ? '' : 's'} may still use the old name. SQL is not rewritten automatically.`);
  };

  return (
    <div className={cn('rounded-md', open && 'bg-surface-2/60')}>
      <div className="grid grid-cols-[minmax(0,1fr)_124px_auto_20px] items-center gap-1.5">
        <TextCommit cell mono aria-label={`Column name ${c.name}`} value={c.name} validate={(v) => identError(v, taken)} onCommit={rename} />
        <Select size="sm" mono aria-label={`Type of ${c.name}`} value={c.type.kind} options={KIND_OPTIONS} onValueChange={(k) => mutCol((col) => setColumnKind(col, k as Kind))} />
        <div className="flex items-center gap-1">
          <FlagToggle label="NN" title="NOT NULL" on={!c.nullable} disabled={pk || c.autoIncrement} onClick={() => mutCol((col) => { col.nullable = !col.nullable; })} />
          <FlagToggle label="PK" title="Primary key" on={pk} onClick={() => mutate((t) => togglePk(t, c.name))} />
          <FlagToggle label="UQ" title="Unique" on={isUniqueCol(table, c.name)} onClick={() => mutate((t) => toggleUnique(t, c.name))} />
          <FlagToggle label="AI" title={isIntKind(c.type.kind) ? 'AUTO_INCREMENT' : 'AUTO_INCREMENT needs an integer type'} on={c.autoIncrement} disabled={!isIntKind(c.type.kind) || !!c.generated} onClick={() => mutate((t) => toggleAutoIncrement(t, c.name))} />
        </div>
        <button
          type="button"
          aria-label={open ? `Collapse ${c.name}` : `Expand ${c.name}`}
          aria-expanded={open}
          onClick={onToggle}
          className={cn('flex h-6 w-5 items-center justify-center rounded text-faint hover:text-fg', problems.length > 0 && 'text-bad hover:text-bad')}
        >
          {problems.length > 0 ? <AlertCircle size={14} /> : open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {open && (
        <div className="mx-1 mb-2 mt-1 flex flex-col gap-3 border-t border-line px-1 pb-1 pt-3">
          {problems.map((p, i) => <div key={i} className={cn('text-xs', p.severity === 'error' ? 'text-bad' : 'text-warn')}>{p.message}</div>)}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <TypeParams type={c.type} onChange={(type) => mutCol((col) => { col.type = type; })} />
            {!c.generated && !c.autoIncrement && (
              <Field label="Default" hint="NULL, 42, 'text', (expr), CURRENT_TIMESTAMP(3)" className="col-span-2">
                <TextCommit mono placeholder="none" value={formatDefault(c.default)} onCommit={(v) => mutCol((col) => { col.default = parseDefault(v, col.type); })} />
              </Field>
            )}
            <div className="col-span-2 flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                <Switch aria-label="Generated column" checked={!!c.generated} onCheckedChange={(on) => mutCol((col) => { if (on) { col.generated = { expr: '1' }; col.autoIncrement = false; col.default = undefined; col.seed = undefined; } else col.generated = undefined; })} />
                Generated column (STORED)
              </label>
              {c.generated && <TextCommit mono aria-label="Generated expression" placeholder="SQL expression, e.g. IF(status = 'ACTIVE', account_id, NULL)" value={c.generated.expr} onCommit={(expr) => mutCol((col) => { col.generated = { expr: expr || '1' }; })} />}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">Seed generator</div>
            {seeded ? (
              <>
                <Select
                  size="sm"
                  aria-label={`Seed generator for ${c.name}`}
                  value={seedKind}
                  options={SEED_OPTIONS}
                  onValueChange={(k) => mutCol((col, t) => { col.seed = k === 'auto' ? undefined : defaultGenerator(k as GenKind, refFor(design.schema, t, col.name)); })}
                />
                {c.seed ? (
                  <>
                    <GeneratorForm value={c.seed} schema={design.schema} siblingColumns={siblings} onChange={(seed) => mutCol((col) => { col.seed = seed; })} />
                    <SampleStrip gen={c.seed} seed={schemaSeed} />
                  </>
                ) : (
                  <p className="text-xs text-faint">Filled with generated values {inferredSeedLabel(c)}; foreign key columns draw from the parent keys.</p>
                )}
              </>
            ) : (
              <p className="text-xs text-faint">Not seeded: {inferredSeedLabel(c)}.</p>
            )}
          </div>

          <div className="flex justify-end">
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} className="hover:text-bad" disabled={table.columns.length === 1} onClick={() => {
              const mentions = sqlMentions(design, c.name);
              update((d) => deleteColumn(d, table.name, c.name));
              if (mentions > 0) toast.info(`Deleted ${c.name}`, `${mentions} workload statement${mentions === 1 ? '' : 's'} mention a column with this name.`);
            }}>Delete column</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- table editor
export function TableEditor({ table, problems, onDeleted, onRenamed }: { table: Table; problems: Problem[]; onDeleted: () => void; onRenamed?: (name: string) => void }) {
  const toast = useToast();
  const design = useDesignStore((s) => s.design);
  const update = useDesignStore((s) => s.update);
  const mutate = useMutate(table.name);
  const [openCol, setOpenCol] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const schema = design.schema;
  const colNames = table.columns.map((c) => c.name);
  const otherTables = schema.tables.map((t) => t.name).filter((n) => n !== table.name);
  const byColumn = useMemo(() => {
    const m = new Map<string, Problem[]>();
    for (const p of problems) if (p.path.column) m.set(p.path.column, [...(m.get(p.path.column) ?? []), p]);
    return m;
  }, [problems]);
  const tableLevel = problems.filter((p) => !p.path.column);
  const firstNonPk = table.columns.find((c) => !table.primaryKey.includes(c.name))?.name ?? colNames[0]!;

  const addColumn = () => {
    const col = newColumn(table);
    mutate((t) => { t.columns.push(col); });
    setOpenCol(col.name);
  };

  const rename = (to: string) => {
    const mentions = sqlMentions(design, table.name);
    update((d) => renameTable(d, table.name, to));
    onRenamed?.(to);
    if (mentions > 0) toast.info(`Renamed ${table.name} to ${to}`, `${mentions} workload statement${mentions === 1 ? '' : 's'} may still use the old name. SQL is not rewritten automatically.`);
  };

  const removeTable = () => {
    const mentions = sqlMentions(design, table.name);
    update((d) => deleteTable(d, table.name));
    setConfirmDelete(false);
    onDeleted();
    if (mentions > 0) toast.info(`Deleted ${table.name}`, `${mentions} workload statement${mentions === 1 ? '' : 's'} mention it and will fail validation.`);
  };

  return (
    <div className="flex flex-col">
      <PanelSection title="Table">
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label="Name" error={undefined}>
            <TextCommit mono aria-label="Table name" value={table.name} validate={(v) => identError(v, otherTables)} onCommit={rename} />
          </Field>
          <Field label="Seed rows">{(id) => <NumberField id={id} min={0} max={2_000_000} value={table.seedRows} onCommit={(seedRows) => mutate((t) => { t.seedRows = seedRows; })} />}</Field>
        </div>
        {tableLevel.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {tableLevel.map((p, i) => (
              <li key={i} className={cn('flex gap-1.5 text-xs', p.severity === 'error' ? 'text-bad' : 'text-warn')}><AlertCircle size={13} className="mt-0.5 shrink-0" />{p.message}</li>
            ))}
          </ul>
        )}
      </PanelSection>

      <PanelSection title="Columns" count={table.columns.length} action={<AddButton label="Add column" onClick={addColumn} />}>
        <div className="mb-1 grid grid-cols-[minmax(0,1fr)_124px_auto_20px] gap-1.5 px-0.5 text-[11px] uppercase tracking-wide text-faint">
          <span>Name</span><span>Type</span><span className="w-[116px]">Flags</span><span />
        </div>
        <div className="flex flex-col gap-0.5">
          {table.columns.map((c) => (
            <ColumnRow
              key={c.name}
              table={table}
              column={c}
              open={openCol === c.name}
              onToggle={() => setOpenCol(openCol === c.name ? null : c.name)}
              problems={byColumn.get(c.name) ?? []}
              mutate={mutate}
              schemaSeed={design.seed}
            />
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Primary key">
        <ColumnPicker aria-label="Primary key columns" options={colNames} value={table.primaryKey} placeholder="No primary key" invalid={table.primaryKey.length === 0}
          onChange={(v) => v.length > 0 && mutate((t) => { t.primaryKey = v; for (const c of t.columns) if (v.includes(c.name)) c.nullable = false; })} />
      </PanelSection>

      <PanelSection title="Unique constraints" count={table.uniques.length} action={<AddButton label="Add unique constraint" onClick={() => mutate((t) => { t.uniques.push({ columns: [firstNonPk] }); })} />}>
        {table.uniques.length === 0 && <p className="text-xs text-faint">None. A UNIQUE key may span several columns.</p>}
        <div className="flex flex-col gap-2">
          {table.uniques.map((u, i) => (
            <div key={i} className="grid grid-cols-[96px_minmax(0,1fr)_28px] items-center gap-1.5">
              <TextCommit mono placeholder="auto name" aria-label="Constraint name" value={u.name ?? ''} validate={optionalName([])} onCommit={(v) => mutate((t) => { t.uniques[i]!.name = v || undefined; })} />
              <ColumnPicker aria-label="Unique columns" options={colNames} value={u.columns} invalid={u.columns.length === 0} onChange={(v) => v.length > 0 && mutate((t) => { t.uniques[i]!.columns = v; })} />
              <RemoveButton label="Remove unique constraint" onClick={() => mutate((t) => { t.uniques.splice(i, 1); })} />
            </div>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Indexes" count={table.indexes.length} action={<AddButton label="Add index" onClick={() => mutate((t) => { t.indexes.push({ name: uniqueName(`ix_${t.name}_${firstNonPk}`.slice(0, 64), t.indexes.map((x) => x.name)), columns: [firstNonPk], unique: false }); })} />}>
        {table.indexes.length === 0 && <p className="text-xs text-faint">None. Add one to speed up lookups; the advisor suggests indexes after a run.</p>}
        <div className="flex flex-col gap-2">
          {table.indexes.map((ix, i) => (
            <div key={i} className="grid grid-cols-[112px_minmax(0,1fr)_auto_28px] items-center gap-1.5">
              <TextCommit mono aria-label="Index name" value={ix.name} validate={(v) => identError(v, table.indexes.map((x) => x.name).filter((_, k) => k !== i))} onCommit={(v) => mutate((t) => { t.indexes[i]!.name = v; })} />
              <ColumnPicker aria-label="Index columns" options={colNames} value={ix.columns} invalid={ix.columns.length === 0} onChange={(v) => v.length > 0 && mutate((t) => { t.indexes[i]!.columns = v; })} />
              <label className="flex items-center gap-1.5 text-xs text-muted">UQ<Switch aria-label="Unique index" checked={ix.unique} onCheckedChange={(unique) => mutate((t) => { t.indexes[i]!.unique = unique; })} /></label>
              <RemoveButton label="Remove index" onClick={() => mutate((t) => { t.indexes.splice(i, 1); })} />
            </div>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Foreign keys" count={table.foreignKeys.length} action={schema.tables.length > 0 ? <AddButton label="Add foreign key" onClick={() => mutate((t) => { t.foreignKeys.push(newForeignKey(schema, t)); })} /> : undefined}>
        {table.foreignKeys.length === 0 && <p className="text-xs text-faint">None. Drag from a column handle on the canvas to another table's key column to create one.</p>}
        <div className="flex flex-col gap-3">
          {table.foreignKeys.map((fk, i) => {
            const ref = schema.tables.find((t) => t.name === fk.refTable);
            const mismatch = fk.columns.length !== fk.refColumns.length;
            return (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2/40 p-2.5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_28px] items-center gap-1.5">
                  <ColumnPicker aria-label="Foreign key columns" options={colNames} value={fk.columns} invalid={fk.columns.length === 0 || mismatch} onChange={(v) => v.length > 0 && mutate((t) => { t.foreignKeys[i]!.columns = v; })} />
                  <span className="font-mono text-xs text-faint">to</span>
                  <Select
                    mono
                    aria-label="Referenced table"
                    value={fk.refTable}
                    options={[...(ref ? [] : [{ value: fk.refTable, label: `${fk.refTable} (missing)` }]), ...schema.tables.map((t) => ({ value: t.name, label: t.name }))]}
                    onValueChange={(v) => mutate((t) => { const p = schema.tables.find((x) => x.name === v); t.foreignKeys[i]!.refTable = v; t.foreignKeys[i]!.refColumns = p ? [p.primaryKey[0] ?? p.columns[0]!.name] : t.foreignKeys[i]!.refColumns; })}
                  />
                  <RemoveButton label="Remove foreign key" onClick={() => mutate((t) => { t.foreignKeys.splice(i, 1); })} />
                </div>
                <ColumnPicker aria-label="Referenced columns" options={ref?.columns.map((c) => c.name) ?? []} value={fk.refColumns} invalid={mismatch} placeholder="Referenced columns" onChange={(v) => v.length > 0 && mutate((t) => { t.foreignKeys[i]!.refColumns = v; })} />
                {mismatch && <div className="text-xs text-bad">{fk.columns.length} column{fk.columns.length === 1 ? '' : 's'} reference {fk.refColumns.length}: the counts must match.</div>}
                <div className="grid grid-cols-2 gap-2">
                  <Field label="On delete">{(id) => <Select id={id} size="sm" value={fk.onDelete} options={ACTIONS} onValueChange={(v) => mutate((t) => { t.foreignKeys[i]!.onDelete = v as never; })} />}</Field>
                  <Field label="On update">{(id) => <Select id={id} size="sm" value={fk.onUpdate} options={ACTIONS} onValueChange={(v) => mutate((t) => { t.foreignKeys[i]!.onUpdate = v as never; })} />}</Field>
                </div>
              </div>
            );
          })}
        </div>
      </PanelSection>

      <PanelSection title="Check constraints" count={table.checks.length} action={<AddButton label="Add check" onClick={() => mutate((t) => { t.checks.push({ expr: `${firstNonPk} IS NOT NULL` }); })} />}>
        {table.checks.length === 0 && <p className="text-xs text-faint">None. MySQL validates the expression when the sandbox is provisioned.</p>}
        <div className="flex flex-col gap-2">
          {table.checks.map((ck, i) => (
            <div key={i} className="grid grid-cols-[88px_minmax(0,1fr)_28px] items-center gap-1.5">
              <TextCommit mono placeholder="auto name" aria-label="Check name" value={ck.name ?? ''} validate={optionalName([])} onCommit={(v) => mutate((t) => { t.checks[i]!.name = v || undefined; })} />
              <TextCommit mono aria-label="Check expression" value={ck.expr} validate={(v) => (v.trim() ? null : 'Required')} onCommit={(v) => mutate((t) => { t.checks[i]!.expr = v.trim(); })} />
              <RemoveButton label="Remove check" onClick={() => mutate((t) => { t.checks.splice(i, 1); })} />
            </div>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Danger zone">
        <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)}>Delete table</Button>
      </PanelSection>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${table.name}?`}
        description="Foreign keys that reference it are removed too. You can undo with Ctrl+Z."
        footer={<><Button onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={removeTable}>Delete table</Button></>}
      >
        <p className="text-sm text-muted">{table.columns.length} columns and {table.seedRows.toLocaleString('en-US')} seed rows will be removed from the design.</p>
      </Dialog>
    </div>
  );
}

