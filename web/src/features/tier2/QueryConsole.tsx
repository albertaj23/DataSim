// Read-only SQL console against the provisioned sandbox (POST /api/projects/:id/sandbox/query, 200-row cap).
import { Database, Loader2, Play, ScanSearch } from 'lucide-react';
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import type { QueryResponse } from '@datasim/shared';
import { useDesignStore } from '../../lib/designStore';
import { formatNumber } from '../../lib/format';
import { isNotProvisioned, sandboxQuery, useProvision, type SandboxFailure } from '../../lib/sandbox';
import { Button, EmptyState, Kbd, ProvenanceTag, Skeleton, cn } from '../../ui';
import { isSelectLike, starterQuery } from './queryLogic';

const QueryEditor = lazy(() => import('./QueryEditor'));

/** Keeps each project's text while the panel is closed (the tab content unmounts). */
const memory = new Map<string, string>();

function Cell({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="italic text-faint">NULL</span>;
  if (typeof v === 'object') return <>{JSON.stringify(v)}</>;
  return <>{String(v)}</>;
}

export function QueryConsole() {
  const projectId = useDesignStore((s) => s.projectId) ?? '';
  const tables = useDesignStore((s) => s.design.schema.tables);
  const schema = useMemo(() => Object.fromEntries(tables.map((t) => [t.name, t.columns.map((c) => c.name)])), [tables]);
  const [text, setText] = useState(() => memory.get(projectId) ?? starterQuery(tables.map((t) => t.name)));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ sql: string; res: QueryResponse } | null>(null);
  const [error, setError] = useState<SandboxFailure | null>(null);
  const textRef = useRef(text);
  const prov = useProvision();

  const change = (v: string) => { textRef.current = v; setText(v); memory.set(projectId, v); };

  const run = useCallback(async (sql = textRef.current) => {
    const q = sql.trim().replace(/;+\s*$/, '');
    if (!q) return;
    setBusy(true);
    const r = await sandboxQuery(q);
    setBusy(false);
    if (r.ok) { setResult({ sql: q, res: r.value }); setError(null); }
    else { setError(r.error); setResult(null); }
  }, []);

  const explain = () => {
    const q = textRef.current.trim().replace(/;+\s*$/, '');
    if (q) void run(/^explain\b/i.test(q) ? q : `EXPLAIN ${q}`);
  };
  const provisionThenRun = async () => {
    const r = await prov.run();
    if (r.ok) void run();
  };

  const numeric = useMemo(() => (result ? result.res.columns.map((_, i) => typeof result.res.rows.find((r) => r[i] != null)?.[i] === 'number') : []), [result]);
  const notProvisioned = !!error && isNotProvisioned(error);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-faint">Tables</span>
          {tables.length === 0 && <span className="text-xs text-faint">none yet</span>}
          {tables.map((t) => (
            <button key={t.name} type="button" onClick={() => change(`SELECT * FROM \`${t.name}\` LIMIT 20`)} className="rounded border border-line bg-surface-2 px-1.5 py-px font-mono text-xs text-muted transition-colors hover:border-line-strong hover:text-fg">{t.name}</button>
          ))}
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-surface transition-colors focus-within:border-accent">
          <Suspense fallback={<Skeleton className="h-24 w-full rounded-none" />}>
            <QueryEditor value={text} onChange={change} onRun={() => void run()} schema={schema} />
          </Suspense>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" variant="primary" icon={<Play size={14} />} loading={busy} onClick={() => void run()} data-testid="run-query">Run</Button>
          <span className="flex items-center gap-1 text-xs text-faint"><Kbd>Ctrl</Kbd><Kbd>Enter</Kbd></span>
          <Button size="sm" icon={<ScanSearch size={14} />} disabled={busy || !isSelectLike(text)} onClick={explain}>Explain</Button>
          <span className="ml-auto text-xs text-faint">Read-only SELECT and EXPLAIN, max 200 rows</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {notProvisioned ? (
          <div className="p-4">
            <EmptyState
              icon={<Database size={20} />}
              title="The sandbox is not provisioned"
              description={prov.error ? prov.error.message : 'Queries run against a real MySQL database created from this schema and seeded with generated rows. Provision it once, then query.'}
              actions={<Button variant="primary" size="sm" loading={prov.busy} onClick={() => void provisionThenRun()}>Provision sandbox and run</Button>}
            />
            {prov.busy && prov.progress && (
              <p className="mt-3 flex items-center justify-center gap-2 font-mono text-xs text-info tnum"><Loader2 size={14} className="ds-spin" />Provisioning sandbox &middot; {formatNumber(prov.progress.doneRows)} / {formatNumber(prov.progress.allRows)} rows &middot; {prov.progress.table}</p>
            )}
          </div>
        ) : error ? (
          <div className="m-3 rounded-lg border border-bad/30 bg-bad/5 p-3">
            <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-bad">{error.code === 'QUERY_ERROR' ? 'MySQL error' : error.code === 'BAD_SQL' ? 'Not allowed' : 'Error'}</div>
            <p className="break-words font-mono text-xs leading-relaxed text-fg">{error.message}</p>
          </div>
        ) : result ? (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 whitespace-nowrap border-b border-line px-3 py-1.5 text-xs">
              <span className="font-mono text-fg tnum">{formatNumber(result.res.rows.length)} {result.res.rows.length === 1 ? 'row' : 'rows'}</span>
              <span className="font-mono text-muted tnum">{result.res.ms.toFixed(result.res.ms < 10 ? 2 : 1)} ms</span>
              <ProvenanceTag kind="MEASURED" />
            </div>
            {result.res.truncated && <div className="border-b border-warn/30 bg-warn/5 px-3 py-1.5 text-xs text-warn">Showing the first 200 rows only. Add a WHERE or LIMIT to see specific rows.</div>}
            {result.res.columns.length === 0 ? (
              <p className="p-4 text-xs text-muted">The statement returned no result set.</p>
            ) : result.res.rows.length === 0 ? (
              <p className="p-4 text-xs text-muted">No rows matched.</p>
            ) : (
              <table className="w-full border-collapse text-left font-mono text-xs">
                <thead className="sticky top-0 z-[1] bg-surface-2">
                  <tr>
                    <th className="h-7 w-10 border-b border-line px-2 text-right font-normal text-faint">#</th>
                    {result.res.columns.map((c, i) => <th key={`${c}-${i}`} className={cn('h-7 whitespace-nowrap border-b border-line px-3 font-medium text-muted', numeric[i] && 'text-right')}>{c}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.res.rows.map((row, i) => (
                    <tr key={i} className="h-7 hover:bg-surface-2">
                      <td className="px-2 text-right text-faint tnum">{i + 1}</td>
                      {row.map((v, j) => (
                        <td key={j} className={cn('max-w-[260px] truncate px-3 text-fg', typeof v === 'number' && 'text-right tnum')} title={v === null || v === undefined ? 'NULL' : String(v)}><Cell v={v} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <p className="p-4 text-xs text-muted">Run a query to see rows here. The console shows the sandbox as it was last provisioned, not unsaved schema edits.</p>
        )}
      </div>
    </div>
  );
}
