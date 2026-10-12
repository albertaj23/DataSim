import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Play } from 'lucide-react';
import { api } from '../../lib/api';
import type { IndexExperimentResult, IndexVariant, LabErrorBody } from '../../lib/labApi';
import { Button, Pill, ProvenanceTag, Table, TBody, TD, TH, THead, TR } from '../../ui';
import { formatMs, formatNumber } from '../../lib/format';
import { ChartCard } from '../charts';
import { AXIS, GRID } from '../charts/common';
import { labErrorMessage } from './logic';
import { Notice, Panel } from './widgets';

const VARIANT: Record<IndexVariant['variant'], { title: string; sub: string }> = {
  WITH_INDEX: { title: 'Both indexes', sub: 'composite (account_id, status, lease_expires_at) present' },
  WITHOUT_COMPOSITE: { title: 'Without composite', sub: 'only (status, lease_expires_at) left' },
  WITHOUT_ANY_INDEX: { title: 'No usable index', sub: 'full scan of the clustered index' },
};

const SHORT: Record<IndexVariant['variant'], string> = { WITH_INDEX: 'both indexes', WITHOUT_COMPOSITE: 'no composite', WITHOUT_ANY_INDEX: 'no index' };

export function IndexExperiment() {
  const [result, setResult] = useState<IndexExperimentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);

  async function run() {
    setBusy(true); setError(null);
    const r = await api.post<IndexExperimentResult & LabErrorBody>('/lab/index-experiment');
    setBusy(false);
    if (r.ok) setResult(r.body); else setError(labErrorMessage({ status: r.status, code: r.body.code, message: r.body.message }));
  }

  const chart = (result?.variants ?? []).map((v) => ({ name: SHORT[v.variant], locks: v.locksHeld, blocked: v.otherAccountBlocked }));

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Index experiment"
        subtitle="The composite index changes the lock footprint of an UPDATE, not only its speed"
        actions={<ProvenanceTag kind="MEASURED" />}
      >
        <div className="flex flex-col gap-3">
          <p className="max-w-[860px] text-sm text-muted">
            Loads about 20,000 historical allocations, then for each index setup runs the CONSTRAINT strategy&apos;s expire UPDATE for one account inside a REPEATABLE READ
            transaction and counts the InnoDB locks it holds (<span className="font-mono">performance_schema.data_locks</span>). A second connection then runs the same UPDATE for a different account
            with a 1 s lock wait timeout. Without the composite index InnoDB locks every index record it scans, so unrelated accounts block each other. Test rows are deleted and both indexes are restored afterwards.
          </p>
          <div className="flex items-center gap-3">
            <Button variant="primary" icon={<Play size={16} />} loading={busy} onClick={run}>Run index experiment</Button>
            {busy && <span className="font-mono text-xs text-muted tnum" aria-live="polite">Running · {elapsed} s (usually 5 to 15 s)</span>}
          </div>
          {error && <Notice>{error}</Notice>}
        </div>
      </Panel>

      {result ? (
        <>
          <div className="rounded-[10px] border border-accent/30 bg-accent/5 px-3.5 py-2.5 text-sm text-fg">{result.finding}</div>
          <Panel title="Results" subtitle={`${formatNumber(result.historyRows)} allocation rows loaded across ${result.accountsTouched} lab accounts, then deleted`} actions={<ProvenanceTag kind="MEASURED" />}>
            <div className="flex flex-col gap-4">
              <Table aria-label="Index experiment results">
                <THead>
                  <tr>
                    <TH>Index setup</TH>
                    <TH>EXPLAIN key</TH>
                    <TH>Access type</TH>
                    <TH align="right" title="Optimizer estimate; can be stale right after a bulk load">Rows est.</TH>
                    <TH align="right">Count query</TH>
                    <TH align="right">Locks held</TH>
                    <TH align="right">Record / table</TH>
                    <TH>Other account</TH>
                  </tr>
                </THead>
                <TBody>
                  {result.variants.map((v) => (
                    <TR key={v.variant}>
                      <TD className="py-1.5">
                        <div className="font-medium">{VARIANT[v.variant].title}</div>
                        <div className="text-xs text-faint">{VARIANT[v.variant].sub}</div>
                      </TD>
                      <TD mono>{v.explain.key ?? 'none'}</TD>
                      <TD><Pill tone={v.explain.type === 'ALL' ? 'red' : 'green'} mono>{v.explain.type ?? '-'}</Pill></TD>
                      <TD align="right" mono>{formatNumber(v.explain.rows)}</TD>
                      <TD align="right" mono>{formatMs(v.countMs)}</TD>
                      <TD align="right" mono className={v.locksHeld > 100 ? 'font-medium text-bad' : 'text-ok'}>{formatNumber(v.locksHeld)}</TD>
                      <TD align="right" mono className="text-muted">{formatNumber(v.recordLocks)} / {formatNumber(v.tableLocks)}</TD>
                      <TD>
                        {v.otherAccountBlocked
                          ? <Pill tone="red" mono>blocked · {formatMs(v.otherAccountMs)}</Pill>
                          : <Pill tone="green" mono>ran freely · {formatMs(v.otherAccountMs)}</Pill>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>

              <ChartCard title="Locks held by one account's UPDATE" provenance="MEASURED" height={150} legend={[{ label: 'other account blocked', color: 'var(--bad)' }, { label: 'ran freely', color: 'var(--ok)' }]}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} layout="vertical" margin={{ top: 2, right: 44, bottom: 0, left: 0 }}>
                    <CartesianGrid {...GRID} vertical horizontal={false} />
                    <XAxis type="number" allowDecimals={false} {...AXIS} />
                    <YAxis type="category" dataKey="name" width={96} interval={0} {...AXIS} />
                    <Tooltip
                      cursor={{ fill: 'var(--surface-3)' }}
                      isAnimationActive={false}
                      content={({ active, payload }) => active && payload?.length ? (
                        <div className="rounded-md border border-line bg-surface-2 px-2 py-1.5 text-xs">
                          <span className="text-muted">{String(payload[0]!.payload.name)}</span>{' '}
                          <span className="font-mono tnum text-fg">{formatNumber(Number(payload[0]!.value))} locks</span>
                        </div>
                      ) : null}
                    />
                    <Bar dataKey="locks" radius={[0, 3, 3, 0]} isAnimationActive={false} barSize={16}>
                      {chart.map((d) => <Cell key={d.name} fill={d.blocked ? 'var(--bad)' : 'var(--ok)'} />)}
                      <LabelList dataKey="locks" position="right" formatter={(v: number) => formatNumber(v)} style={{ fill: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <div className="flex flex-col gap-1.5">
                {result.variants.map((v) => (
                  <details key={v.variant} className="rounded-lg border border-line bg-surface-2">
                    <summary className="cursor-pointer select-none px-3 py-1.5 text-xs text-muted hover:text-fg">EXPLAIN ANALYZE · {VARIANT[v.variant].title}</summary>
                    <pre className="max-h-48 overflow-auto border-t border-line px-3 py-2 font-mono text-xs text-fg">{v.explainAnalyze || '(no output)'}</pre>
                  </details>
                ))}
              </div>
            </div>
          </Panel>
        </>
      ) : (
        !busy && <div className="grid min-h-28 place-items-center rounded-[10px] border border-dashed border-line px-4 text-center text-sm text-muted">Run the experiment to compare EXPLAIN plans and lock footprints with and without the composite index.</div>
      )}
    </div>
  );
}
