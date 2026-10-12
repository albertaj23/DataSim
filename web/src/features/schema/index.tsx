import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { Database, FileCode2, FileInput, GitFork, Network, Play, Plus, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateDdl, validateDesign, type Problem, type ValidateResponse } from '@datasim/shared';
import { api, errorMessage } from '../../lib/api';
import { useDesignStore } from '../../lib/designStore';
import { useProvision } from '../../lib/sandbox';
import { Button, CodeBlock, EmptyState, Overlay, Pill, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip, useToast } from '../../ui';
import { useTier2Ui } from '../tier2/commands';
import { NormalizeDialog } from '../tier2/NormalizeDialog';
import { QueryConsole } from '../tier2/QueryConsole';
import { ImportDialog } from './ImportDialog';
import { freeSpot, layoutTables, TABLE_W } from './layout';
import { addForeignKey, findTableInMessage, isSchemaProblem, mergeProblems, newTable } from './logic';
import { ProblemsPanel, ProvisionStatus } from './ProblemsPanel';
import { SchemaCanvas } from './SchemaCanvas';
import { SeedDialog } from './SeedDialog';
import { TableEditor } from './TableEditor';

export interface EditorOverlayProps { open: boolean; onClose: () => void; /** Optional table to focus on open. */ focusTable?: string }

type PanelTab = 'table' | 'ddl' | 'query' | 'problems';

function Designer({ focusTable }: { focusTable?: string }) {
  const toast = useToast();
  const rf = useReactFlow();
  const design = useDesignStore((s) => s.design);
  const projectId = useDesignStore((s) => s.projectId);
  const update = useDesignStore((s) => s.update);
  const tables = design.schema.tables;

  const [selected, setSelected] = useState<string | null>(focusTable && tables.some((t) => t.name === focusTable) ? focusTable : null);
  const [tab, setTab] = useState<PanelTab>('table');
  const [seedOpen, setSeedOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [normalizeOpen, setNormalizeOpen] = useState(false);
  const requested = useTier2Ui((s) => s.requested);
  useEffect(() => {
    if (requested === 'normalize' && useTier2Ui.getState().consume('normalize')) setNormalizeOpen(true);
    else if (requested === 'query' && useTier2Ui.getState().consume('query')) setTab('query');
  }, [requested]);
  const [fitToken, setFitToken] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ name: string; token: number } | null>(focusTable ? { name: focusTable, token: 1 } : null);
  const [serverProblems, setServerProblems] = useState<Problem[]>([]);
  const [validating, setValidating] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const prov = useProvision();

  // Server-side results describe the design they were computed for; drop them when it changes.
  const lastDesign = useRef(design);
  useEffect(() => {
    if (lastDesign.current === design) return;
    lastDesign.current = design;
    setServerProblems((p) => (p.length ? [] : p));
    prov.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design]);

  const clientProblems = useMemo(() => validateDesign(design).filter(isSchemaProblem), [design]);
  const problems = useMemo(() => mergeProblems(clientProblems, serverProblems), [clientProblems, serverProblems]);
  const problemByTable = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const p of problems) {
      const t = p.path.table;
      if (!t) continue;
      if (p.severity === 'error' || !m.has(t)) m.set(t, p.severity);
    }
    return m;
  }, [problems]);
  const failedTable = useMemo(() => {
    const e = prov.error;
    if (!e) return null;
    return (e.table && tables.some((t) => t.name === e.table) ? e.table : null) ?? findTableInMessage(e.message, tables.map((t) => t.name));
  }, [prov.error, tables]);

  const ddl = useMemo(() => {
    try { return generateDdl(design.schema).sql || '-- No tables yet. Add a table to see its CREATE TABLE statement.\n'; } catch (e) { return `-- Could not generate DDL: ${(e as Error).message}\n`; }
  }, [design.schema]);

  const selectedTable = tables.find((t) => t.name === selected) ?? null;
  useEffect(() => { if (selected && !selectedTable) setSelected(null); }, [selected, selectedTable]);

  const select = useCallback((name: string | null) => { setSelected(name); if (name) setTab('table'); }, []);
  const focus = useCallback((name: string) => { select(name); setFocusRequest((r) => ({ name, token: (r?.token ?? 0) + 1 })); }, [select]);

  const addTable = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const center = rect ? rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 };
    const t = newTable(design.schema, freeSpot({ x: center.x - TABLE_W / 2, y: center.y - 80 }, tables));
    update((d) => { d.schema.tables.push(t); });
    focus(t.name);
  };

  const autoLayout = () => {
    const pos = layoutTables(design.schema);
    update((d) => { for (const t of d.schema.tables) t.position = pos[t.name] ?? t.position; });
    setFitToken((n) => n + 1);
  };

  const connect = (child: string, childCol: string, parent: string, parentCol: string) => {
    if (!childCol || !parentCol) return;
    let err: string | null = null;
    update((d) => { err = addForeignKey(d.schema, child, childCol, parent, parentCol); });
    if (err) toast.error('Cannot create foreign key', err);
    else { toast.success('Foreign key added', `${child}.${childCol} references ${parent}.${parentCol}`); select(child); }
  };

  const validate = async () => {
    setValidating(true);
    let server: Problem[] = [];
    let serverOk = true;
    if (projectId) {
      const res = await api.post<ValidateResponse>(`/projects/${projectId}/validate`, { design });
      if (res.ok) server = res.body.problems.filter(isSchemaProblem);
      else { serverOk = false; toast.error('Server validation unavailable', errorMessage(res)); }
    }
    setValidating(false);
    setServerProblems(server);
    const all = mergeProblems(clientProblems, server);
    const errors = all.filter((p) => p.severity === 'error').length;
    if (errors === 0 && serverOk) toast.success('Schema is valid', all.length ? `${all.length} warning${all.length === 1 ? '' : 's'}` : 'No problems found');
    else if (errors > 0) toast.error(`${errors} schema error${errors === 1 ? '' : 's'}`, 'See the Problems tab');
    if (all.length) setTab('problems');
  };

  const provision = async () => {
    setTab('problems');
    await prov.run();
  };

  const errorCount = problems.filter((p) => p.severity === 'error').length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-3">
        <Button size="sm" icon={<Plus size={14} />} onClick={addTable}>Add table</Button>
        <Button size="sm" icon={<Network size={14} />} onClick={autoLayout} disabled={tables.length < 2}>Auto layout</Button>
        <Button size="sm" icon={<Database size={14} />} onClick={() => setSeedOpen(true)} disabled={tables.length === 0}>Seed data</Button>
        <Button size="sm" icon={<FileInput size={14} />} onClick={() => setImportOpen(true)}>Import DDL</Button>
        <Button size="sm" icon={<GitFork size={14} />} onClick={() => setNormalizeOpen(true)}>Normalize</Button>
        <div className="mx-1 h-5 w-px bg-line" />
        <Button size="sm" variant={tab === 'ddl' ? 'secondary' : 'ghost'} className={tab === 'ddl' ? 'border-accent/50 text-accent' : undefined} icon={<FileCode2 size={14} />} onClick={() => setTab(tab === 'ddl' ? 'table' : 'ddl')}>DDL</Button>
        <Button size="sm" icon={<ShieldCheck size={14} />} loading={validating} onClick={validate}>
          Validate
          {problems.length > 0 && <Pill tone={errorCount ? 'red' : 'amber'} mono className="ml-0.5">{problems.length}</Pill>}
        </Button>
        <Tooltip content={projectId ? 'Apply the DDL to a sandbox database and seed it' : 'Open a project to provision'}>
          <span>
            <Button size="sm" variant="primary" icon={<Play size={14} />} loading={prov.busy} disabled={!projectId || tables.length === 0} onClick={provision}>Provision sandbox</Button>
          </span>
        </Tooltip>
        <div className="ml-auto min-w-0 max-w-[46%] truncate pl-3">
          {(prov.busy || prov.result || prov.error) && <ProvisionStatus compact view={prov} failedTable={failedTable} onShowTable={focus} />}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={canvasRef} className="relative min-w-0 flex-1">
          <SchemaCanvas tables={tables} selected={selected} onSelect={select} problemByTable={problemByTable} failedTable={failedTable} onConnect={connect} fitToken={fitToken} focusRequest={focusRequest} />
          {tables.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <EmptyState className="pointer-events-auto bg-bg" title="No tables yet" description="Add a table, then add columns and drag from a column handle to another table's key to create a foreign key." actions={<Button variant="primary" icon={<Plus size={14} />} onClick={addTable}>Add table</Button>} />
            </div>
          )}
        </div>

        <aside className="flex w-[560px] shrink-0 flex-col border-l border-line bg-surface" aria-label="Schema inspector">
          <Tabs value={tab} onValueChange={(v) => setTab(v as PanelTab)} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="shrink-0 px-2">
              <TabsTrigger value="table">{selectedTable ? <span className="max-w-[160px] truncate font-mono">{selectedTable.name}</span> : 'Table'}</TabsTrigger>
              <TabsTrigger value="ddl">DDL</TabsTrigger>
              <TabsTrigger value="query">Query</TabsTrigger>
              <TabsTrigger value="problems" count={problems.length || undefined}>Problems</TabsTrigger>
            </TabsList>
            <TabsContent value="table" className="min-h-0 flex-1 overflow-auto">
              {selectedTable ? (
                <TableEditor key={selectedTable.name} table={selectedTable} problems={problems.filter((p) => p.path.table === selectedTable.name)} onDeleted={() => setSelected(null)} />
              ) : (
                <div className="p-4">
                  <EmptyState title="No table selected" description="Select a table on the canvas to edit its columns, keys, constraints and seed generators." />
                </div>
              )}
            </TabsContent>
            <TabsContent value="ddl" className="min-h-0 flex-1 overflow-auto p-3">
              <CodeBlock code={ddl} downloadName="schema.sql" maxHeight={Math.max(320, window.innerHeight - 160)} lineNumbers />
            </TabsContent>
            <TabsContent value="query" className="min-h-0 flex-1 overflow-hidden">
              <QueryConsole />
            </TabsContent>
            <TabsContent value="problems" className="min-h-0 flex-1 overflow-auto">
              <ProblemsPanel problems={problems} provision={prov} failedTable={failedTable} onSelectTable={(t) => focus(t)} checkedOnServer={serverProblems.length > 0} />
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={(first) => { setFitToken((n) => n + 1); if (first) select(first); }} />
      <NormalizeDialog
        open={normalizeOpen}
        onOpenChange={setNormalizeOpen}
        initialTable={selected ?? undefined}
        onApplied={(created) => { setFitToken((n) => n + 1); if (created[0]) select(created[0]); }}
      />
      <SeedDialog
        open={seedOpen}
        onOpenChange={setSeedOpen}
        schema={design.schema}
        onApply={(rows) => update((d) => { for (const t of d.schema.tables) if (rows[t.name] !== undefined) t.seedRows = rows[t.name]!; })}
      />
    </div>
  );
}

export function SchemaDesigner({ open, onClose, focusTable }: EditorOverlayProps) {
  return (
    <Overlay open={open} onClose={onClose} title="Schema designer">
      <ReactFlowProvider>
        <Designer focusTable={focusTable} />
      </ReactFlowProvider>
    </Overlay>
  );
}
