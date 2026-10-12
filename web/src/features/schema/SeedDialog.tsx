import { useEffect, useState } from 'react';
import type { SchemaModel } from '@datasim/shared';
import { formatNumber } from '../../lib/format';
import { Button, Dialog, Field, NumberField } from '../../ui';
import { scaledRows } from './logic';

const FACTORS = [0.1, 0.5, 2, 10];

/** Edit seed row counts per table, or scale them all, then apply as one undo step. */
export function SeedDialog({ open, onOpenChange, schema, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; schema: SchemaModel; onApply: (rows: Record<string, number>) => void }) {
  const [rows, setRows] = useState<Record<string, number>>({});
  useEffect(() => {
    if (open) setRows(Object.fromEntries(schema.tables.map((t) => [t.name, t.seedRows])));
  }, [open, schema]);
  const total = schema.tables.reduce((n, t) => n + (rows[t.name] ?? t.seedRows), 0);
  const current = schema.tables.reduce((n, t) => n + t.seedRows, 0);
  const scale = (f: number) => setRows(Object.fromEntries(schema.tables.map((t) => [t.name, scaledRows(rows[t.name] ?? t.seedRows, f)])));
  const changed = schema.tables.some((t) => rows[t.name] !== undefined && rows[t.name] !== t.seedRows);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Seed data"
      description="Rows generated per table when the sandbox is provisioned. Seeds are deterministic for the design seed."
      width={520}
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!changed} onClick={() => { onApply(rows); onOpenChange(false); }}>Apply</Button></>}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs text-muted">Scale all rows</span>
        <div className="flex gap-1.5">
          {FACTORS.map((f) => <Button key={f} size="sm" onClick={() => scale(f)}>{`${f}x`}</Button>)}
        </div>
      </div>
      {schema.tables.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Add a table first.</p>
      ) : (
        <div className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {schema.tables.map((t) => (
            <div key={t.name} className="grid grid-cols-[1fr_96px_120px] items-center gap-3 px-3 py-1.5">
              <span className="truncate font-mono text-sm" title={t.name}>{t.name}</span>
              <span className="text-right font-mono text-xs text-faint tnum">{formatNumber(t.seedRows)}</span>
              <Field label={<span className="sr-only">Rows for {t.name}</span>}>
                {(id) => <NumberField id={id} aria-label={`Rows for ${t.name}`} min={0} max={2_000_000} value={rows[t.name] ?? t.seedRows} onCommit={(n) => setRows((r) => ({ ...r, [t.name]: n }))} />}
              </Field>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>Total <span className="font-mono text-fg tnum">{formatNumber(total)}</span> rows{total !== current && <> (was <span className="font-mono tnum">{formatNumber(current)}</span>)</>}</span>
        <span className="text-faint">Provision the sandbox to generate them.</span>
      </div>
    </Dialog>
  );
}
