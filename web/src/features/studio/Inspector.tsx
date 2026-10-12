import { Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MAX_TOTAL_POOL, type DesignNode } from '@datasim/shared';
import { useDesignStore } from '../../lib/designStore';
import { Button, FormRow, Input, NumberField, Pill, ProvenanceTag, SectionHeader, Select, Slider } from '../../ui';
import { useStudioActions } from './actions';
import { patchConfig, patchEdge, renameNode, schemaSummary, workloadSummary } from './mutations';
import { NODE_ICON } from './NodeCard';
import { ISOLATION_OPTIONS, NODE_META, STRATEGY_OPTIONS } from './nodes';
import { useStudioUi } from './studioUi';

const update = (fn: Parameters<ReturnType<typeof useDesignStore.getState>['update']>[0]) => useDesignStore.getState().update(fn);

function Section({ title, tag, children }: { title: string; tag?: 'EMULATED' | 'MEASURED'; children: ReactNode }) {
  return (
    <section className="border-b border-line px-3 pb-2 pt-1 last:border-b-0">
      <SectionHeader title={title} action={tag ? <ProvenanceTag kind={tag} /> : undefined} />
      {children}
    </section>
  );
}

/** Slider that only commits on release, so dragging is one undo step. */
function CommitSlider({ value, min, max, onCommit, label }: { value: number; min: number; max: number; onCommit: (v: number) => void; label: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <Slider aria-label={label} value={v} min={min} max={max} onValueChange={setV} onValueCommit={onCommit} />;
}

function NameField({ node }: { node: DesignNode }) {
  const [text, setText] = useState(node.name);
  useEffect(() => setText(node.name), [node.name, node.id]);
  const commit = () => { const t = text.trim(); if (t && t !== node.name) update((d) => renameNode(d, node.id, t)); else setText(node.name); };
  return (
    <Input
      value={text} aria-label="Node name" maxLength={60}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') { setText(node.name); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

function UsersForm({ node }: { node: Extract<DesignNode, { type: 'users' }> }) {
  const c = node.config;
  const set = (patch: Partial<typeof c>) => update((d) => patchConfig(d, node.id, 'users', patch));
  const design = useDesignStore((s) => s.design);
  const workload = useMemo(() => workloadSummary(design), [design]);
  const openWorkload = useStudioUi((s) => s.openWorkload);
  return (
    <>
      <Section title="Load">
        <FormRow label="Virtual users">{(id) => <NumberField id={id} value={c.vus} min={1} max={500} unit="VUs" onCommit={(vus) => set({ vus })} />}</FormRow>
        <div className="pb-1 pl-[120px]"><CommitSlider label="Virtual users" value={c.vus} min={1} max={500} onCommit={(vus) => set({ vus })} /></div>
        <FormRow label="Pattern">{(id) => <Select id={id} value={c.pattern} onValueChange={(pattern) => set({ pattern })} options={['constant', 'ramp', 'spike', 'step'].map((v) => ({ value: v as typeof c.pattern, label: v }))} />}</FormRow>
        <FormRow label="Duration">{(id) => <NumberField id={id} value={c.durationS} min={1} max={600} unit="s" onCommit={(durationS) => set({ durationS })} />}</FormRow>
        <FormRow label="Warm-up" hint="Not measured">{(id) => <NumberField id={id} value={c.warmupS} min={0} max={60} unit="s" onCommit={(warmupS) => set({ warmupS })} />}</FormRow>
      </Section>
      <Section title="Think time">
        <FormRow label="Distribution">{(id) => <Select id={id} value={c.thinkDist} onValueChange={(thinkDist) => set({ thinkDist })} options={['uniform', 'exponential', 'fixed'].map((v) => ({ value: v as typeof c.thinkDist, label: v }))} />}</FormRow>
        <FormRow label="Min">{(id) => <NumberField id={id} value={c.thinkMinMs} min={0} max={60000} unit="ms" onCommit={(thinkMinMs) => set({ thinkMinMs, thinkMaxMs: Math.max(c.thinkMaxMs, thinkMinMs) })} />}</FormRow>
        <FormRow label="Max" hint={c.thinkDist === 'fixed' ? 'Ignored: fixed uses min' : undefined}>{(id) => <NumberField id={id} value={c.thinkMaxMs} min={0} max={60000} unit="ms" onCommit={(thinkMaxMs) => set({ thinkMaxMs, thinkMinMs: Math.min(c.thinkMinMs, thinkMaxMs) })} />}</FormRow>
      </Section>
      <Section title="Workload">
        {workload.length === 0 ? (
          <p className="py-1 text-xs text-muted">No transactions yet. Define them in the workload editor.</p>
        ) : (
          <ul className="mb-2 flex flex-col gap-1">
            {workload.map((t) => (
              <li key={t.name} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-mono text-fg">{t.name}</span>
                <Pill>{t.readOnly ? 'read' : 'write'}</Pill>
                <span className="w-9 text-right font-mono text-muted tnum">{t.pct}%</span>
              </li>
            ))}
          </ul>
        )}
        <Button size="sm" className="w-full" onClick={openWorkload}>Open workload editor</Button>
      </Section>
    </>
  );
}

function AppForm({ node }: { node: Extract<DesignNode, { type: 'app' }> }) {
  const c = node.config;
  const set = (patch: Partial<typeof c>) => update((d) => patchConfig(d, node.id, 'app', patch));
  const totalPool = useDesignStore((s) => s.design.nodes.reduce((sum, n) => sum + (n.type === 'app' ? n.config.instances * n.config.poolSize : 0), 0));
  return (
    <>
      <Section title="Capacity">
        <FormRow label="Instances">{(id) => <NumberField id={id} value={c.instances} min={1} max={8} unit="x" onCommit={(instances) => set({ instances })} />}</FormRow>
        <FormRow label="Workers">{(id) => <NumberField id={id} value={c.workers} min={1} max={256} unit="per inst." onCommit={(workers) => set({ workers })} />}</FormRow>
        <FormRow label="DB pool" hint={<span className={totalPool > MAX_TOTAL_POOL ? 'text-bad' : undefined}>Total connections {totalPool} / {MAX_TOTAL_POOL}</span>}>
          {(id) => <NumberField id={id} value={c.poolSize} min={1} max={100} unit="per inst." invalid={totalPool > MAX_TOTAL_POOL} onCommit={(poolSize) => set({ poolSize })} />}
        </FormRow>
        <div className="pb-1 pl-[120px]"><CommitSlider label="DB pool size" value={c.poolSize} min={1} max={100} onCommit={(poolSize) => set({ poolSize })} /></div>
      </Section>
      <Section title="Processing" tag="EMULATED">
        <FormRow label="Mean">{(id) => <NumberField id={id} value={c.processingMeanMs} min={0} max={5000} step={0.5} unit="ms" onCommit={(processingMeanMs) => set({ processingMeanMs })} />}</FormRow>
        <FormRow label="Jitter">{(id) => <NumberField id={id} value={c.processingJitterMs} min={0} max={5000} step={0.5} unit="ms" onCommit={(processingJitterMs) => set({ processingJitterMs })} />}</FormRow>
      </Section>
      <Section title="Concurrency control">
        <FormRow label="Strategy">{(id) => <Select id={id} value={c.strategy} onValueChange={(strategy) => update((d) => { for (const n of d.nodes) if (n.type === 'app') n.config.strategy = strategy; })} options={STRATEGY_OPTIONS} />}</FormRow>
        <FormRow label="Retries" hint="Deadlock, lock timeout, CAS failure">{(id) => <NumberField id={id} value={c.retry.max} min={0} max={10} unit="max" onCommit={(max) => set({ retry: { ...c.retry, max } })} />}</FormRow>
        <FormRow label="Backoff">{(id) => <NumberField id={id} value={c.retry.backoffMs} min={0} max={5000} unit="ms" onCommit={(backoffMs) => set({ retry: { ...c.retry, backoffMs } })} />}</FormRow>
      </Section>
    </>
  );
}

function LbForm({ node }: { node: Extract<DesignNode, { type: 'lb' }> }) {
  return (
    <Section title="Routing" tag="EMULATED">
      <FormRow label="Algorithm">
        {(id) => <Select id={id} value={node.config.algorithm} onValueChange={(algorithm) => update((d) => patchConfig(d, node.id, 'lb', { algorithm }))} options={[{ value: 'round-robin', label: 'round-robin' }, { value: 'least-connections', label: 'least-connections' }]} />}
      </FormRow>
    </Section>
  );
}

function RedisForm({ node }: { node: Extract<DesignNode, { type: 'redis' }> }) {
  return (
    <Section title="Cache">
      <FormRow label="TTL" hint="Applies to transactions marked cacheable in the workload">
        {(id) => <NumberField id={id} value={node.config.ttlS} min={1} max={86400} unit="s" onCommit={(ttlS) => update((d) => patchConfig(d, node.id, 'redis', { ttlS }))} />}
      </FormRow>
    </Section>
  );
}

function MysqlForm({ node }: { node: Extract<DesignNode, { type: 'mysql' }> }) {
  const c = node.config;
  const set = (patch: Partial<typeof c>) => update((d) => patchConfig(d, node.id, 'mysql', patch));
  const design = useDesignStore((s) => s.design);
  const sum = useMemo(() => schemaSummary(design), [design]);
  const openSchema = useStudioUi((s) => s.openSchema);
  return (
    <>
      <Section title="Engine">
        <FormRow label="Engine"><span className="font-mono text-xs text-fg">MySQL 8.4 · InnoDB</span></FormRow>
        <FormRow label="Isolation">{(id) => <Select id={id} value={c.isolation} onValueChange={(isolation) => set({ isolation })} options={ISOLATION_OPTIONS} />}</FormRow>
        <FormRow label="Lock wait">{(id) => <NumberField id={id} value={c.lockWaitTimeoutS} min={1} max={60} unit="s" onCommit={(lockWaitTimeoutS) => set({ lockWaitTimeoutS })} />}</FormRow>
        <FormRow label="Max exec time" hint="0 = unlimited">{(id) => <NumberField id={id} value={c.maxExecutionTimeMs} min={0} max={600000} step={100} unit="ms" onCommit={(maxExecutionTimeMs) => set({ maxExecutionTimeMs })} />}</FormRow>
      </Section>
      <Section title="Schema">
        <dl className="mb-2 grid grid-cols-3 gap-2">
          {([['Tables', sum.tables], ['Seed rows', sum.rows], ['Indexes', sum.indexes]] as const).map(([k, v]) => (
            <div key={k} className="rounded-md border border-line bg-surface px-2 py-1.5">
              <dt className="text-[11px] text-faint">{k}</dt>
              <dd className="font-mono text-sm text-fg tnum">{v.toLocaleString('en-US')}</dd>
            </div>
          ))}
        </dl>
        <Button size="sm" className="w-full" onClick={() => openSchema()}>Open schema designer</Button>
      </Section>
    </>
  );
}

function NodeInspector({ node }: { node: DesignNode }) {
  const actions = useStudioActions();
  const Icon = NODE_ICON[node.type];
  return (
    <>
      <div className="border-b border-line p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted">
          <Icon size={14} />
          <span>{NODE_META[node.type].label}</span>
          <span className="ml-auto font-mono text-[11px] text-faint">{node.id}</span>
        </div>
        <NameField node={node} />
      </div>
      {node.type === 'users' && <UsersForm node={node} />}
      {node.type === 'lb' && <LbForm node={node} />}
      {node.type === 'app' && <AppForm node={node} />}
      {node.type === 'redis' && <RedisForm node={node} />}
      {node.type === 'mysql' && <MysqlForm node={node} />}
      <div className="p-3">
        <Button variant="danger" size="sm" icon={<Trash2 size={14} />} className="w-full" onClick={() => actions.remove([node.id])}>Delete node</Button>
      </div>
    </>
  );
}

function EdgeInspector({ edgeId }: { edgeId: string }) {
  const edge = useDesignStore((s) => s.design.edges.find((e) => e.id === edgeId));
  const nodes = useDesignStore((s) => s.design.nodes);
  const nameOf = (id?: string) => nodes.find((n) => n.id === id)?.name ?? id ?? '';
  const names = edge ? [nameOf(edge.source), nameOf(edge.target)] : null;
  const actions = useStudioActions();
  if (!edge || !names) return null;
  return (
    <>
      <div className="border-b border-line p-3">
        <div className="mb-1 text-xs text-muted">Link</div>
        <div className="truncate text-sm text-fg">{names[0]} <span className="text-faint">to</span> {names[1]}</div>
      </div>
      <Section title="Network" tag="EMULATED">
        <FormRow label="Latency" hint="One-way delay, really awaited on each request">{(id) => <NumberField id={id} value={edge.latencyMs} min={0} max={2000} step={0.5} unit="ms" onCommit={(latencyMs) => update((d) => patchEdge(d, edge.id, { latencyMs }))} />}</FormRow>
        <FormRow label="Jitter">{(id) => <NumberField id={id} value={edge.jitterMs} min={0} max={2000} step={0.5} unit="ms" onCommit={(jitterMs) => update((d) => patchEdge(d, edge.id, { jitterMs }))} />}</FormRow>
      </Section>
      <div className="p-3">
        <Button variant="danger" size="sm" icon={<Trash2 size={14} />} className="w-full" onClick={() => actions.remove([], [edge.id])}>Delete link</Button>
      </div>
    </>
  );
}

function Overview() {
  const d = useDesignStore((s) => s.design);
  const rows: [string, number][] = [['Components', d.nodes.length], ['Links', d.edges.length], ['Tables', d.schema.tables.length], ['Transactions', d.workload.transactions.length]];
  return (
    <div className="p-3">
      <h2 className="mb-1 text-sm font-medium text-fg">Design</h2>
      <p className="mb-3 text-xs text-muted">Select a component or a link to edit it. Double-click Users for the workload, the database for the schema.</p>
      <dl className="grid grid-cols-2 gap-2">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded-md border border-line bg-surface px-2 py-1.5">
            <dt className="text-[11px] text-faint">{k}</dt>
            <dd className="font-mono text-sm text-fg tnum">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Inspector() {
  const selectedNode = useStudioUi((s) => s.selectedNode);
  const selectedEdge = useStudioUi((s) => s.selectedEdge);
  const focusTick = useStudioUi((s) => s.focusTick);
  const node = useDesignStore((s) => (selectedNode ? s.design.nodes.find((n) => n.id === selectedNode) ?? null : null));
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusTick) return;
    const t = setTimeout(() => root.current?.querySelector<HTMLElement>('input, [role=combobox]')?.focus(), 30);
    return () => clearTimeout(t);
  }, [focusTick]);

  return (
    <aside ref={root} aria-label="Inspector" className="flex h-full w-80 shrink-0 flex-col overflow-auto border-l border-line bg-surface">
      {node ? <NodeInspector key={node.id} node={node} /> : selectedEdge ? <EdgeInspector key={selectedEdge} edgeId={selectedEdge} /> : <Overview />}
    </aside>
  );
}
