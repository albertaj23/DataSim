import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Check, CircleAlert, Database, History, Save, ShieldCheck } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { InvariantEditor } from '../components/workbench/InvariantEditor';
import { ModelEditor } from '../components/workbench/ModelEditor';
import { RunConsole } from '../components/workbench/RunConsole';
import { TransactionsEditor } from '../components/workbench/TransactionsEditor';
import { Badge, Button } from '../components/ui';
import { api, type ErrorBody } from '../lib/api';
import { usePageMeta } from '../lib/shell';
import type { Workspace, WorkspaceDefinition } from '../lib/workspaces';

type Section = 'model' | 'transactions' | 'invariant' | 'run';
const sections: Array<{ id: Section; label: string }> = [
  { id: 'model', label: 'Model' }, { id: 'transactions', label: 'Transactions' }, { id: 'invariant', label: 'Invariant' }, { id: 'run', label: 'Run & evidence' },
];

function errorMessage(body: unknown, fallback: string): string {
  return (body as ErrorBody | undefined)?.message || fallback;
}

function definitionText(definition: WorkspaceDefinition): string {
  return JSON.stringify(definition);
}

export default function WorkspacePage() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [savedDefinition, setSavedDefinition] = useState<WorkspaceDefinition | null>(null);
  const [definition, setDefinition] = useState<WorkspaceDefinition | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [section, setSection] = useState<Section>(() => {
    const requested = searchParams.get('section');
    return sections.some((item) => item.id === requested) ? requested as Section : 'model';
  });
  const [revisions, setRevisions] = useState<Array<{ revision: number; contentHash: string; createdAt: string }>>([]);
  const [showRevisions, setShowRevisions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');

  usePageMeta({ title: workspace?.name ?? 'Workspace', chapter: 'Scenario bench' });

  const loadWorkspace = useCallback(async () => {
    setError('');
    try {
      const result = await api.get<Workspace>(`/workspaces/${id}`);
      if (!result.ok) throw new Error(errorMessage(result.body, 'Could not open this workspace.'));
      const value = result.body;
      setWorkspace(value);
      setName(value.name);
      setDescription(value.description);
      setDefinition(value.definition);
      setSavedDefinition(value.definition);
      setSavedAt(value.updatedAt);
      const history = await api.get<typeof revisions>(`/workspaces/${id}/revisions`);
      if (history.ok) setRevisions(history.body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open this workspace.');
    }
  }, [id]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);
  const isDirty = useMemo(() => {
    if (!workspace || !savedDefinition || !definition) return false;
    return name !== workspace.name || description !== workspace.description || definitionText(definition) !== definitionText(savedDefinition);
  }, [workspace, savedDefinition, definition, name, description]);

  async function save() {
    if (!definition || !workspace) return;
    setBusy(true); setError('');
    try {
      const metadata = await api.patch<Workspace>(`/workspaces/${workspace.id}`, { name: name.trim(), description: description.trim() });
      if (!metadata.ok) throw new Error(errorMessage(metadata.body, 'Could not save workspace details.'));
      const saved = await api.put<Workspace>(`/workspaces/${workspace.id}/definition`, definition);
      if (!saved.ok) throw new Error(errorMessage(saved.body, 'Could not save the model revision.'));
      setWorkspace(saved.body);
      setName(saved.body.name);
      setDescription(saved.body.description);
      setDefinition(saved.body.definition);
      setSavedDefinition(saved.body.definition);
      setSavedAt(new Date().toISOString());
      const history = await api.get<typeof revisions>(`/workspaces/${workspace.id}/revisions`);
      if (history.ok) setRevisions(history.body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save workspace.');
    } finally { setBusy(false); }
  }

  async function reload() {
    if (isDirty && !window.confirm('Discard unsaved edits and reload the last saved revision?')) return;
    await loadWorkspace();
  }

  function handleSectionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? sections.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
    const next = sections[nextIndex];
    if (!next) return;
    setSection(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  if (!workspace || !definition) {
    return <div className="workbench-page">
      <Link to="/" className="workbench-back"><ArrowLeft size={15} /> Workspace library</Link>
      {error ? <div role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : <div className="workbench-empty mt-5">Loading workspace…</div>}
    </div>;
  }

  return (
    <div className="workbench-page space-y-5">
      <Link to="/" className="workbench-back"><ArrowLeft size={15} /> Workspace library</Link>
      <header className="workbench-header workbench-header-compact">
        <div className="min-w-0 flex-1">
          <p className="workbench-eyebrow"><Database size={14} /> WORKSPACE / MYSQL INNODB / REVISION {workspace.revision}</p>
          <label className="sr-only" htmlFor="workspace-name">Workspace name</label>
          <input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} className="workbench-name-input" />
          <label className="sr-only" htmlFor="workspace-description">Workspace description</label>
          <input id="workspace-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add a short description…" className="mt-1 w-full max-w-2xl bg-transparent text-sm text-stone-400 outline-none placeholder:text-stone-600" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={isDirty ? 'amber' : 'green'}>{isDirty ? 'Unsaved edits' : 'Saved'}</Badge>
          <Button size="sm" onClick={() => void reload()} disabled={busy}>Reload</Button>
          <Button size="sm" variant="primary" onClick={() => void save()} disabled={busy || !isDirty}><Save size={14} /> {busy ? 'Saving…' : 'Save revision'}</Button>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}

      <div className="workbench-statusbar flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2">
        <span className="flex items-center gap-2 text-xs text-stone-400"><span className={`h-2 w-2 rounded-full ${isDirty ? 'bg-amber-300' : 'bg-emerald-300'}`} />{isDirty ? 'Draft changes are local until saved.' : `Saved ${new Date(savedAt).toLocaleString()}`}</span>
        <button className="flex items-center gap-1.5 text-xs text-sky-300 hover:underline" onClick={() => setShowRevisions(!showRevisions)} aria-expanded={showRevisions}><History size={13} /> Revision history ({revisions.length})</button>
      </div>
      {showRevisions && <div className="workbench-panel flex flex-wrap gap-2 p-3" aria-label="Immutable workspace revisions">
        {revisions.map((revision) => <div key={revision.revision} className="rounded-lg border border-fg/8 px-3 py-2 text-xs">
          <div className="font-mono text-stone-200">r{revision.revision} · {revision.contentHash.slice(0, 12)}</div>
          <div className="mt-1 text-stone-500">{new Date(revision.createdAt).toLocaleString()}</div>
        </div>)}
      </div>}

      <div role="tablist" aria-label="Workspace editor sections" className="workbench-tabs">
        {sections.map((item, index) => <button key={item.id} role="tab" id={`tab-${item.id}`} tabIndex={section === item.id ? 0 : -1} aria-selected={section === item.id} aria-controls={`panel-${item.id}`} onKeyDown={(event) => handleSectionKeyDown(event, index)} onClick={() => setSection(item.id)}>{section === item.id && <motion.span layoutId="workbench-tab-active" className="workbench-tab-active" transition={{ type: 'spring', stiffness: 420, damping: 32 }} />}{item.label}</button>)}
      </div>

      <div role="tabpanel" id={`panel-${section}`} aria-labelledby={`tab-${section}`} className="min-h-[300px]">
        {section === 'model' && <ModelEditor definition={definition} onChange={setDefinition} />}
        {section === 'transactions' && <TransactionsEditor definition={definition} onChange={setDefinition} />}
        {section === 'invariant' && <InvariantEditor definition={definition} onChange={setDefinition} />}
        {section === 'run' && <RunConsole workspace={workspace} isDirty={isDirty} key={workspace.revision} />}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-fg/8 pt-4 text-xs text-stone-500">
        <span className="flex items-center gap-2"><ShieldCheck size={14} /> Runs pin the immutable revision and definition hash.</span>
        <span className="flex items-center gap-1"><Check size={13} /> No destructive database reset</span>
      </footer>
    </div>
  );
}
