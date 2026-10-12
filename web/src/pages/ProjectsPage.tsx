import { Archive, ArrowUpRight, Copy, FilePlus2, FolderPlus, Plus, RefreshCw, ServerOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectDetail, ProjectSummary, TemplateInfo } from '@datasim/shared';
import { api, errorMessage } from '../lib/api';
import { formatMs, relativeTime } from '../lib/format';
import { PageContainer, PageHeader } from '../shell/Page';
import {
  Button, Dialog, EmptyState, IconButton, Pill, Skeleton, SplitButton, TBody, TD, TH, THead, TR, Table, cn, useToast, type Tone,
} from '../ui';

type Data = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; projects: ProjectSummary[]; templates: TemplateInfo[] };

function verdict(p: ProjectSummary): { tone: Tone; text: string } | null {
  const r = p.lastRun;
  if (!r) return null;
  if (r.status === 'FAILED') return { tone: 'red', text: 'failed' };
  if (r.status === 'CANCELLED') return { tone: 'neutral', text: 'cancelled' };
  if (r.sloPass === true) return { tone: 'green', text: 'PASS' };
  if (r.sloPass === false) return { tone: 'red', text: 'FAIL' };
  return { tone: 'neutral', text: r.status === 'COMPLETED' ? 'no SLO' : r.status.toLowerCase() };
}

function TemplateCard({ t, busy, onPick }: { t: TemplateInfo; busy: boolean; onPick: () => void }) {
  return (
    <button
      type="button" onClick={onPick} disabled={busy} data-testid={`template-${t.key}`}
      className={cn('flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-surface p-3 text-left transition-colors duration-150 ease-out hover:border-line-strong hover:bg-surface-2 disabled:opacity-60', busy && 'cursor-wait')}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-fg">{t.name}</span>
        <span className="shrink-0 text-faint">{busy ? <RefreshCw size={14} className="ds-spin" /> : <Plus size={14} />}</span>
      </span>
      <span className="truncate text-xs text-muted" title={t.summary}>{t.summary}</span>
      <span className="flex min-w-0 flex-wrap gap-1">{t.tags.slice(0, 3).map((tag) => <Pill key={tag}>{tag}</Pill>)}</span>
    </button>
  );
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<Data>({ state: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<ProjectSummary | null>(null);

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([api.get<ProjectSummary[]>('/projects'), api.get<TemplateInfo[]>('/templates')]);
    if (!p.ok || !Array.isArray(p.body)) { setData({ state: 'error', message: errorMessage(p) }); return; }
    setData({ state: 'ready', projects: p.body, templates: t.ok && Array.isArray(t.body) ? t.body : [] });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const templateName = useMemo(() => new Map(data.state === 'ready' ? data.templates.map((t) => [t.key, t.name]) : []), [data]);

  const create = async (key: string | null) => {
    setBusy(key ?? 'blank');
    const res = key
      ? await api.post<ProjectDetail>(`/templates/${key}/instantiate`, {})
      : await api.post<ProjectDetail>('/projects', { name: 'Untitled design' });
    setBusy(null);
    if (!res.ok) { toast.error(key ? 'Could not create from template' : 'Could not create the project', errorMessage(res)); return; }
    navigate(`/p/${res.body.projectId}`);
  };

  const duplicate = async (p: ProjectSummary) => {
    setBusy(`dup:${p.projectId}`);
    const res = await api.post<ProjectDetail>(`/projects/${p.projectId}/duplicate`);
    setBusy(null);
    if (!res.ok) { toast.error('Could not duplicate', errorMessage(res)); return; }
    toast.success('Design duplicated', res.body.name);
    navigate(`/p/${res.body.projectId}`);
  };

  const archive = async () => {
    const p = archiving;
    if (!p) return;
    setBusy(`arch:${p.projectId}`);
    const res = await api.post(`/projects/${p.projectId}/archive`);
    setBusy(null); setArchiving(null);
    if (!res.ok) { toast.error('Could not archive', errorMessage(res)); return; }
    setData((d) => (d.state === 'ready' ? { ...d, projects: d.projects.filter((x) => x.projectId !== p.projectId) } : d));
    toast.success('Project archived', `${p.name} is hidden. Its runs are kept.`);
  };

  const templates = data.state === 'ready' ? data.templates.slice(0, 4) : [];

  return (
    <PageContainer>
      <PageHeader
        title="Projects"
        actions={
          <SplitButton
            label="New project" icon={<Plus size={14} />} loading={busy === 'blank'} menuLabel="New project options" onClick={() => void create(null)}
            actions={[
              { key: 'blank', label: 'Blank design', icon: <FilePlus2 size={14} />, onSelect: () => void create(null) },
              ...templates.map((t) => ({ key: t.key, label: `From template: ${t.name}`, icon: <FolderPlus size={14} />, onSelect: () => void create(t.key) })),
            ]}
          />
        }
      />

      {data.state === 'error' && (
        <EmptyState icon={<ServerOff size={20} />} title="Could not load projects" description={data.message} actions={<Button icon={<RefreshCw size={14} />} onClick={() => { setData({ state: 'loading' }); void load(); }}>Retry</Button>} />
      )}

      {data.state !== 'error' && (
        <>
          <section aria-label="Templates" className="mb-6">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Start from a template</h2>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {data.state === 'loading'
                ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-lg" />)
                : templates.map((t) => <TemplateCard key={t.key} t={t} busy={busy === t.key} onPick={() => void create(t.key)} />)}
            </div>
          </section>

          <section aria-label="Projects">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Your projects</h2>
            {data.state === 'loading' ? (
              <div className="flex flex-col gap-1.5" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
            ) : data.projects.length === 0 ? (
              <EmptyState
                title="No projects yet" description="Start from a template above, or open a blank canvas."
                actions={<Button variant="primary" icon={<Plus size={14} />} onClick={() => void create(null)}>Blank design</Button>}
              />
            ) : (
              <Table>
                <THead><TR>
                  <TH>Name</TH><TH>Template</TH><TH>Last verdict</TH><TH align="right">Last p95</TH><TH>Updated</TH><TH className="w-[120px]"><span className="sr-only">Actions</span></TH>
                </TR></THead>
                <TBody>
                  {data.projects.map((p) => {
                    const v = verdict(p);
                    return (
                      <TR key={p.projectId} interactive onClick={() => navigate(`/p/${p.projectId}`)} className="group h-10" data-testid="project-row">
                        <TD className="max-w-[340px]"><span className="block truncate font-medium">{p.name}</span></TD>
                        <TD className="text-muted">{p.templateKey ? templateName.get(p.templateKey) ?? p.templateKey : <span className="text-faint">blank</span>}</TD>
                        <TD>{v ? <Pill tone={v.tone} className="font-medium">{v.text}</Pill> : <span className="text-faint">no runs</span>}</TD>
                        <TD align="right" mono>{p.lastRun && p.lastRun.status === 'COMPLETED' ? formatMs(p.lastRun.p95Ms) : <span className="text-faint">-</span>}</TD>
                        <TD className="whitespace-nowrap text-muted">{relativeTime(p.updatedAt)}</TD>
                        <TD align="right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <IconButton size="sm" label="Open" icon={<ArrowUpRight size={14} />} onClick={() => navigate(`/p/${p.projectId}`)} />
                            <IconButton size="sm" label="Duplicate (fork)" icon={<Copy size={14} />} loading={busy === `dup:${p.projectId}`} onClick={() => void duplicate(p)} />
                            <IconButton size="sm" label="Archive" icon={<Archive size={14} />} onClick={() => setArchiving(p)} />
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </section>
        </>
      )}

      <Dialog
        open={!!archiving} onOpenChange={(o) => !o && setArchiving(null)} title="Archive project" width={400}
        description={archiving ? `${archiving.name} will be hidden from this list. Its revisions and runs are kept.` : undefined}
        footer={<><Button onClick={() => setArchiving(null)}>Cancel</Button><Button variant="danger" loading={!!archiving && busy === `arch:${archiving.projectId}`} onClick={() => void archive()}>Archive</Button></>}
      >
        <p className="text-sm text-muted">You can still open its runs from the Runs page.</p>
      </Dialog>
    </PageContainer>
  );
}
