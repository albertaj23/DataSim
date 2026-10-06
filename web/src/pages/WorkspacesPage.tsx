import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive, Boxes, Clock3, Copy, FilePlus2, Layers3, Plus, Search, Sparkles, Undo2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card } from '../components/ui';
import { CardStack } from '../components/ui/CardStack';
import { api, type ErrorBody } from '../lib/api';
import { usePageMeta } from '../lib/shell';
import type { WorkspaceSummary, WorkspaceTemplate } from '../lib/workspaces';

function errorMessage(body: unknown, fallback: string): string {
  const message = (body as ErrorBody | undefined)?.message;
  return message || fallback;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function WorkspacesPage({ templatesOnly = false }: { templatesOnly?: boolean }) {
  const navigate = useNavigate();
  usePageMeta({ title: templatesOnly ? 'Templates' : 'Workspaces', chapter: templatesOnly ? 'Starting configurations' : 'Your concurrency lab' });
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [name, setName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [workspaceResult, templateResult] = await Promise.all([
        api.get<WorkspaceSummary[]>(`/workspaces?q=${encodeURIComponent(query)}&archived=${archived}`),
        api.get<WorkspaceTemplate[]>('/templates'),
      ]);
      if (!workspaceResult.ok) throw new Error(errorMessage(workspaceResult.body, 'Could not load workspaces.'));
      if (!templateResult.ok) throw new Error(errorMessage(templateResult.body, 'Could not load templates.'));
      setWorkspaces(workspaceResult.body);
      setTemplates(templateResult.body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load workspace data.');
    }
  }, [query, archived]);

  useEffect(() => { void load(); }, [load]);

  const visibleTemplates = useMemo(() => templates.filter((template) => template.id !== 'blank'), [templates]);

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    const workspaceName = name.trim();
    if (!workspaceName) return;
    setBusy('create');
    setError('');
    try {
      const result = await api.post<WorkspaceSummary>('/workspaces', { name: workspaceName, description: '' });
      if (!result.ok) throw new Error(errorMessage(result.body, 'Could not create the workspace.'));
      navigate(`/workspaces/${result.body.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the workspace.');
    } finally {
      setBusy(null);
    }
  }

  async function instantiate(id: string, title: string) {
    setBusy(id);
    setError('');
    try {
      const result = id === 'blank'
        ? await api.post<WorkspaceSummary>('/workspaces', { name: title, description: '' })
        : await api.post<WorkspaceSummary>(`/templates/${id}/instantiate`, {});
      if (!result.ok) throw new Error(errorMessage(result.body, 'Could not create a workspace from this starting point.'));
      navigate(`/workspaces/${result.body.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the workspace.');
      setBusy(null);
    }
  }

  async function updateName(workspace: WorkspaceSummary) {
    const nextName = window.prompt('Workspace name', workspace.name);
    if (!nextName?.trim() || nextName.trim() === workspace.name) return;
    const result = await api.patch<WorkspaceSummary>(`/workspaces/${workspace.id}`, { name: nextName.trim() });
    if (!result.ok) setError(errorMessage(result.body, 'Could not rename the workspace.'));
    else await load();
  }

  async function duplicate(workspace: WorkspaceSummary) {
    setBusy(workspace.id);
    const result = await api.post<WorkspaceSummary>(`/workspaces/${workspace.id}/duplicate`, {});
    if (!result.ok) setError(errorMessage(result.body, 'Could not duplicate the workspace.'));
    else await load();
    setBusy(null);
  }

  async function archiveWorkspace(workspace: WorkspaceSummary) {
    if (!window.confirm(`Archive "${workspace.name}"? Its run evidence will be kept.`)) return;
    const result = await api.delete(`/workspaces/${workspace.id}`);
    if (!result.ok) setError(errorMessage(result.body, 'Could not archive the workspace.'));
    else await load();
  }

  async function restoreWorkspace(workspace: WorkspaceSummary) {
    const result = await api.post(`/workspaces/${workspace.id}/restore`);
    if (!result.ok) setError(errorMessage(result.body, 'Could not restore the workspace.'));
    else await load();
  }

  const allTemplates = [
    { id: 'blank', title: 'Blank workspace', description: 'Create your own tables, actors, operations, and invariant.' },
    ...visibleTemplates,
  ];

  return (
    <div className="workbench-page space-y-7">
      <header className="workbench-header">
        <div>
          <p className="workbench-eyebrow"><Layers3 size={15} /> D A T A S I M / CONCURRENCY LAB</p>
          <h1>{templatesOnly ? 'Start from a template' : 'Your workspaces'}</h1>
          <p className="workbench-lede">
            {templatesOnly
              ? 'Each template creates its own editable model, transaction actors, and invariant—not a shortcut to a shared demo.'
              : 'Build a model, configure concurrent transactions, then run against a pinned MySQL revision.'}
          </p>
        </div>
        {!templatesOnly && <Button variant="primary" onClick={() => setShowCreate(true)}><Plus size={16} /> New workspace</Button>}
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}

      {!templatesOnly && (
        <section aria-label="Workspace library" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-md">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
              <input aria-label="Search workspaces" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or description"
                className="workbench-input w-full pl-9" />
            </div>
            <label className="flex items-center gap-2 text-sm text-stone-400">
              <input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />
              Include archived
            </label>
          </div>
          {workspaces.length ? (
            <CardStack
              items={workspaces.map((workspace) => ({ id: workspace.id, value: workspace }))}
              label="Explore workspaces"
              className="workspaces-stack"
              renderItem={(workspace) => (
                <Card key={workspace.id} className="workbench-card" padded={false}>
                  <div className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-semibold">{workspace.name}</h2>
                        <p className="mt-1 line-clamp-2 min-h-10 text-sm text-stone-400">{workspace.description || 'No description yet.'}</p>
                      </div>
                      <Badge tone={workspace.archived ? 'amber' : workspace.latestRunStatus === 'COMPLETED' ? 'green' : 'stone'}>
                        {workspace.archived ? 'Archived' : `r${workspace.revision}`}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-stone-400">
                      <span>{workspace.runCount} saved run{workspace.runCount === 1 ? '' : 's'}</span>
                      <span className="text-right">{workspace.latestRunStatus ?? 'No runs yet'}</span>
                      <span className="col-span-2 flex items-center gap-1.5"><Clock3 size={13} /> Updated {formatTime(workspace.lastActivityAt)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 border-t border-fg/8 pt-3">
                      {!workspace.archived && <Link to={`/workspaces/${workspace.id}`} className="workbench-action">Open bench <span aria-hidden>→</span></Link>}
                      {!workspace.archived && <button className="workbench-icon-action" onClick={() => void updateName(workspace)} aria-label={`Rename ${workspace.name}`}>Rename</button>}
                      {!workspace.archived && <button className="workbench-icon-action" onClick={() => void duplicate(workspace)} disabled={busy === workspace.id}><Copy size={13} /> Duplicate</button>}
                      {workspace.archived
                        ? <button className="workbench-icon-action" onClick={() => void restoreWorkspace(workspace)}><Undo2 size={13} /> Restore</button>
                        : <button className="workbench-icon-action" onClick={() => void archiveWorkspace(workspace)}><Archive size={13} /> Archive</button>}
                    </div>
                  </div>
                </Card>
              )}
            />
          ) : (
            <div className="workbench-empty">
              <Boxes size={30} />
              <h2>{archived ? 'No archived workspaces' : query ? 'No matching workspaces' : 'Your bench is ready'}</h2>
              <p>{query ? 'Try another search, or clear the filter.' : 'Create an empty workspace or instantiate a starting configuration below.'}</p>
            </div>
          )}
        </section>
      )}

      <section className="space-y-4" aria-labelledby="template-heading">
        <div className="flex items-end justify-between gap-4">
          <div><p className="workbench-eyebrow"><Sparkles size={14} /> STARTING CONFIGURATIONS</p><h2 id="template-heading" className="text-2xl font-semibold">{templatesOnly ? 'Choose a workbench seed' : 'Templates'}</h2></div>
          {!templatesOnly && <Link className="text-sm font-semibold text-sky-300 hover:underline" to="/templates">Browse all templates →</Link>}
        </div>
        <CardStack
          items={allTemplates.map((template) => ({ id: template.id, value: template }))}
          label="Explore starting configurations"
          className="templates-stack"
          renderItem={(template) => (
            <Card key={template.id} className="workbench-template" padded={false}>
              <div className="flex h-full flex-col p-4">
                <div className="flex items-center gap-2 text-sky-300"><FilePlus2 size={17} /><span className="workbench-eyebrow">MYSQL / INNODB</span></div>
                <h3 className="mt-3 text-lg font-semibold">{template.title}</h3>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-stone-400">{template.description}</p>
                <Button className="mt-4 w-full" onClick={() => void instantiate(template.id, template.title)} disabled={busy === template.id}>
                  {busy === template.id ? 'Creating…' : 'Create editable workspace'}
                </Button>
              </div>
            </Card>
          )}
        />
        <p className="text-xs text-stone-500">All templates create a new saved definition. Runs execute only typed operations; arbitrary SQL is not accepted.</p>
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}>
          <form role="dialog" aria-modal="true" aria-labelledby="create-title" onSubmit={(event) => void createWorkspace(event)} className="workbench-dialog w-full max-w-md space-y-4">
            <div><p className="workbench-eyebrow">NEW WORKSPACE</p><h2 id="create-title" className="text-xl font-semibold">Name your concurrency lab</h2></div>
            <label className="block text-sm">Workspace name
              <input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="workbench-input mt-1 w-full" placeholder="e.g. Checkout race experiments" />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={busy === 'create'}>{busy === 'create' ? 'Creating…' : 'Create workspace'}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
