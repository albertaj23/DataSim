// Compact form for any ValueGenerator kind, plus the 5-value sample preview. Used for column seeds and workload params.
import type { SchemaModel, ValueGenerator } from '@datasim/shared';
import { Field, NumberField, Select, cn } from '../../ui';
import { formatConstant, formatList, generatorError, parseConstant, parseList, parseOptionalNumber, parseWeights, sampleStrings, type GenKind } from './gen';
import { TextCommit } from './widgets';

export interface GeneratorFormProps {
  value: ValueGenerator;
  onChange: (g: ValueGenerator) => void;
  schema: SchemaModel;
  /** Other columns of the row (for `email.from`). Omit for workload params. */
  siblingColumns?: string[];
  /** Fit as many fields per row as the width allows (params table) instead of two columns (side panel). */
  wide?: boolean;
}

const DIST = [{ value: 'uniform', label: 'Uniform' }, { value: 'zipf', label: 'Zipf' }] as const;
const MODE = [{ value: 'sequential', label: 'Sequential (unique)' }, { value: 'random', label: 'Random' }] as const;

function Num({ label, value, onCommit, min, max, step, unit }: { label: string; value: number; onCommit: (n: number) => void; min?: number; max?: number; step?: number; unit?: string }) {
  return <Field label={label}>{(id) => <NumberField id={id} value={value} onCommit={onCommit} min={min} max={max} step={step} unit={unit} decimals={step && step < 1 ? 2 : 0} />}</Field>;
}

function OptNum({ label, value, onCommit }: { label: string; value: number | undefined; onCommit: (n: number | undefined) => void }) {
  return (
    <Field label={label}>
      <TextCommit mono placeholder="none" value={value === undefined ? '' : String(value)} validate={(t) => (t.trim() !== '' && parseOptionalNumber(t) === undefined ? 'Number or empty' : null)} onCommit={(t) => onCommit(parseOptionalNumber(t))} />
    </Field>
  );
}

function RefFields({ g, onChange, schema }: { g: Extract<ValueGenerator, { kind: 'fkRef' | 'fromTable' }>; onChange: (g: ValueGenerator) => void; schema: SchemaModel }) {
  const table = schema.tables.find((t) => t.name === g.table);
  const tables = schema.tables.map((t) => ({ value: t.name, label: t.name }));
  const cols = (table?.columns ?? []).map((c) => ({ value: c.name, label: c.name }));
  // A table/column that no longer exists must still render (Radix Select needs the value in the list).
  if (!table) tables.unshift({ value: g.table, label: `${g.table} (missing)` });
  if (table && !cols.some((c) => c.value === g.column)) cols.unshift({ value: g.column, label: `${g.column} (missing)` });
  return (
    <>
      <Field label="Table">{(id) => <Select id={id} mono value={g.table} options={tables} onValueChange={(v) => { const t = schema.tables.find((x) => x.name === v); onChange({ ...g, table: v, column: t?.primaryKey[0] ?? t?.columns[0]?.name ?? g.column }); }} />}</Field>
      <Field label="Column">{(id) => <Select id={id} mono value={g.column} options={cols} onValueChange={(v) => onChange({ ...g, column: v })} />}</Field>
      <Field label="Distribution">{(id) => <Select id={id} value={g.dist} options={[...DIST]} onValueChange={(v) => onChange({ ...g, dist: v })} />}</Field>
      {g.dist === 'zipf' && <Num label="Skew s" value={g.s} min={0.1} max={5} step={0.1} onCommit={(s) => onChange({ ...g, s })} />}
    </>
  );
}

export function GeneratorFields({ value: g, onChange, schema, siblingColumns }: GeneratorFormProps) {
  switch (g.kind) {
    case 'sequence':
      return <><Num label="Start" value={g.start} onCommit={(start) => onChange({ ...g, start })} /><Num label="Step" value={g.step} onCommit={(step) => onChange({ ...g, step })} /></>;
    case 'uniformInt':
      return <><Num label="Min" value={g.min} onCommit={(min) => onChange({ ...g, min })} /><Num label="Max" value={g.max} onCommit={(max) => onChange({ ...g, max })} /></>;
    case 'normalInt':
      return (
        <>
          <Num label="Mean" value={g.mean} onCommit={(mean) => onChange({ ...g, mean })} />
          <Num label="Std dev" value={g.stddev} min={0.01} step={0.5} onCommit={(stddev) => onChange({ ...g, stddev })} />
          <OptNum label="Min" value={g.min} onCommit={(min) => onChange({ ...g, min })} />
          <OptNum label="Max" value={g.max} onCommit={(max) => onChange({ ...g, max })} />
        </>
      );
    case 'zipf':
      return (
        <>
          <Num label="Ranks (n)" value={g.n} min={1} onCommit={(n) => onChange({ ...g, n })} />
          <Num label="Skew s" value={g.s} min={0.1} max={5} step={0.1} onCommit={(s) => onChange({ ...g, s })} />
          <Num label="First rank" value={g.min} onCommit={(min) => onChange({ ...g, min })} />
        </>
      );
    case 'decimalRange':
      return (
        <>
          <Num label="Min" value={g.min} step={0.5} onCommit={(min) => onChange({ ...g, min })} />
          <Num label="Max" value={g.max} step={0.5} onCommit={(max) => onChange({ ...g, max })} />
          <Num label="Scale" value={g.scale} min={0} max={6} onCommit={(scale) => onChange({ ...g, scale })} />
        </>
      );
    case 'pickList':
      return (
        <>
          <Field label="Values (comma separated)" className="col-span-2"><TextCommit mono value={formatList(g.values)} validate={(t) => (parseList(t).length ? null : 'At least one value')} onCommit={(t) => onChange({ ...g, values: parseList(t) })} /></Field>
          <Field label="Weights (optional)" className="col-span-2">
            <TextCommit mono placeholder="equal" value={g.weights ? g.weights.join(', ') : ''} validate={(t) => (t.trim() === '' || parseWeights(t) ? null : 'Positive numbers, comma separated')} onCommit={(t) => onChange({ ...g, weights: parseWeights(t) })} />
          </Field>
        </>
      );
    case 'personName':
      return <p className="col-span-2 text-xs text-faint">Random first and last name.</p>;
    case 'email': {
      const opts = [{ value: '', label: '(row index)' }, ...(siblingColumns ?? []).map((c) => ({ value: c, label: c }))];
      return (
        <>
          <Field label="Derived from">{(id) => <Select id={id} mono value={g.from ?? ''} options={opts} onValueChange={(v) => onChange({ ...g, from: v || undefined })} />}</Field>
          <Field label="Domain"><TextCommit mono value={g.domain} onCommit={(domain) => onChange({ ...g, domain })} /></Field>
        </>
      );
    }
    case 'pattern':
      return (
        <>
          <Field label="Pattern" hint="# digit, @ letter"><TextCommit mono value={g.pattern} validate={(t) => (t ? null : 'Required')} onCommit={(pattern) => onChange({ ...g, pattern })} /></Field>
          <Field label="Mode">{(id) => <Select id={id} value={g.mode} options={[...MODE]} onValueChange={(mode) => onChange({ ...g, mode })} />}</Field>
        </>
      );
    case 'dateRange':
      return <><Field label="From"><TextCommit mono value={g.from} onCommit={(from) => onChange({ ...g, from })} /></Field><Field label="To"><TextCommit mono value={g.to} onCommit={(to) => onChange({ ...g, to })} /></Field></>;
    case 'constant':
      return <Field label="Value" hint="null, true, false, number or text"><TextCommit mono value={formatConstant(g.value)} onCommit={(t) => onChange({ ...g, value: parseConstant(t) })} /></Field>;
    case 'fkRef':
    case 'fromTable':
      return <RefFields g={g} onChange={onChange} schema={schema} />;
    case 'expression':
      return <Field label="Expression" hint="+ - * / ( ), upper lower concat round floor abs" className="col-span-2"><TextCommit mono value={g.expr} validate={(t) => (t.trim() ? null : 'Required')} onCommit={(expr) => onChange({ ...g, expr })} /></Field>;
  }
}

export function GeneratorForm(props: GeneratorFormProps) {
  const err = generatorError(props.value);
  return (
    <div className="flex flex-col gap-2">
      <div className={cn('grid gap-x-3 gap-y-2', props.wide ? 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]' : 'grid-cols-2')}><GeneratorFields {...props} /></div>
      {err && <div className="text-xs text-bad">{err}</div>}
    </div>
  );
}

/** Five sample values as mono chips. */
export function SampleStrip({ gen, seed, className }: { gen: ValueGenerator; seed?: number; className?: string }) {
  if (gen.kind === 'fkRef' || gen.kind === 'fromTable') {
    const dist = gen.dist === 'zipf' ? `zipf s=${gen.s}` : 'uniform';
    return <div className={cn('text-xs text-faint', className)}>{gen.kind === 'fromTable' ? 'Samples' : 'Draws'} <span className="font-mono text-muted">{gen.table}.{gen.column}</span> keys, {dist}{gen.kind === 'fromTable' ? ', loaded when a run starts' : ', from the seeded parent rows'}.</div>;
  }
  if (gen.kind === 'expression') return <div className={cn('text-xs text-faint', className)}>Computed per row from the other columns.</div>;
  const samples = sampleStrings(gen, seed);
  return (
    <div className={cn('flex min-w-0 flex-wrap gap-1', className)} aria-label="Sample values">
      {samples.map((s, i) => (
        <span key={i} title={s} className="max-w-[120px] truncate rounded border border-line bg-surface-2 px-1.5 font-mono text-[11px] leading-[18px] text-muted">{s}</span>
      ))}
    </div>
  );
}

export type { GenKind };
