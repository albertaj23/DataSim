import { useState } from 'react';
import type { SchemaModel } from '@datasim/shared';
import { api, errorMessage } from '../../lib/api';
import { useDesignStore } from '../../lib/designStore';
import { Button, Dialog, useToast } from '../../ui';
import { LazySqlEditor } from '../workload/LazySql';
import { mergeImported } from './importLogic';

interface ImportResponse { schema: SchemaModel; warnings: string[] }

const EXAMPLE = 'CREATE TABLE author (\n  author_id INT AUTO_INCREMENT PRIMARY KEY,\n  name VARCHAR(80) NOT NULL\n);\n';

/** Paste CREATE TABLE DDL. The server applies it in a scratch schema, reads information_schema back and returns a schema model. */
export function ImportDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (o: boolean) => void; onImported: (firstTable: string | null) => void }) {
  const toast = useToast();
  const update = useDesignStore((s) => s.update);
  const [ddl, setDdl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ImportResponse | null>(null);

  const run = async () => {
    setBusy(true); setError(null); setParsed(null);
    const res = await api.post<ImportResponse>('/schema/import', { ddl });
    setBusy(false);
    if (res.ok) setParsed(res.body); else setError(errorMessage(res));
  };

  const apply = (mode: 'replace' | 'add') => {
    if (!parsed) return;
    let result = { skipped: [] as string[], added: [] as string[] };
    update((d) => { result = mergeImported(d.schema, parsed.schema, mode); });
    const { added, skipped } = result;
    toast.success(`Imported ${added.length} ${added.length === 1 ? 'table' : 'tables'}`, skipped.length ? `Skipped existing: ${skipped.join(', ')}` : undefined);
    onOpenChange(false);
    setParsed(null);
    onImported(added[0] ?? null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) { setParsed(null); setError(null); } }}
      title="Import DDL"
      description="CREATE TABLE statements are applied in a scratch schema, then read back from information_schema. MySQL does the parsing."
      width={640}
      footer={
        parsed
          ? <><Button onClick={() => setParsed(null)}>Back</Button><Button onClick={() => apply('replace')}>Replace schema</Button><Button variant="primary" onClick={() => apply('add')}>Add tables</Button></>
          : <><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!ddl.trim()} onClick={run}>Parse DDL</Button></>
      }
    >
      {parsed ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>Found <span className="font-mono">{parsed.schema.tables.length}</span> {parsed.schema.tables.length === 1 ? 'table' : 'tables'}: <span className="font-mono text-muted">{parsed.schema.tables.map((t) => t.name).join(', ')}</span></p>
          {parsed.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-warn">{parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          <p className="text-xs text-muted">Add keeps your tables and skips imported tables with the same name. Replace discards the current schema (undo with Ctrl+Z).</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <LazySqlEditor allowEmpty placeholder={EXAMPLE} value={ddl} schema={{}} scope={null} minHeight={240} maxHeight={360} ariaLabel="DDL to import" onCommit={setDdl} />
          {error && <div className="break-words text-xs text-bad">{error}</div>}
          <p className="text-xs text-faint">Only CREATE TABLE, ALTER TABLE and CREATE INDEX with bare table names are accepted.</p>
        </div>
      )}
    </Dialog>
  );
}
