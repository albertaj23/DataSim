// Ctrl/Cmd+K command palette (cmdk). Mounted once in App; pages add commands through ./commands.
import * as RD from '@radix-ui/react-dialog';
import { Command as Cmdk } from 'cmdk';
import { Activity, Folder, FlaskConical, ListOrdered, Moon, Search, Sun } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectSummary, RunSummary } from '@datasim/shared';
import { api } from '../../lib/api';
import { formatMs, relativeTime, shortId } from '../../lib/format';
import { useTheme } from '../../lib/theme';
import { Kbd, cn } from '../../ui';
import { collectCommands, groupCommands, registerCommands, useCommandRegistry, type Command } from './commands';

interface PaletteApi { open: () => void; toggle: () => void }
const Ctx = createContext<PaletteApi>({ open: () => undefined, toggle: () => undefined });
export const useCommandPalette = () => useContext(Ctx);

const ICON = 16;

/** Commands that exist on every page. */
function useGlobalCommands() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  useEffect(() => registerCommands('global', [
    { id: 'go-projects', title: 'Go to Projects', group: 'Navigate', icon: <Folder size={ICON} />, keywords: ['home', 'designs'], run: () => navigate('/') },
    { id: 'go-runs', title: 'Go to Runs', group: 'Navigate', icon: <Activity size={ICON} />, keywords: ['history', 'reports', 'compare'], run: () => navigate('/runs') },
    { id: 'go-lab', title: 'Go to Concurrency Lab', group: 'Navigate', icon: <FlaskConical size={ICON} />, keywords: ['strategy', 'benchmark', 'lost update'], run: () => navigate('/lab') },
    { id: 'go-stepper', title: 'Go to Transaction Stepper', group: 'Navigate', icon: <ListOrdered size={ICON} />, keywords: ['locks', 'deadlock', 'step'], run: () => navigate('/stepper') },
    { id: 'theme', title: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', group: 'Appearance', icon: theme === 'dark' ? <Sun size={ICON} /> : <Moon size={ICON} />, keywords: ['theme', 'dark', 'light', 'appearance'], run: toggle },
  ]), [navigate, theme, toggle]);
}

function Shortcut({ keys }: { keys: string }) {
  return <span className="ml-auto flex shrink-0 gap-0.5">{keys.split('+').map((k) => <Kbd key={k}>{k}</Kbd>)}</span>;
}

interface Dynamic { projects: ProjectSummary[]; runs: RunSummary[] }

function Palette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const sources = useCommandRegistry((s) => s.sources);
  const [dyn, setDyn] = useState<Dynamic>({ projects: [], runs: [] });
  const [search, setSearch] = useState('');

  // Fresh lists of projects and runs each time the palette opens.
  useEffect(() => {
    if (!open) return;
    setSearch('');
    let cancelled = false;
    void Promise.all([api.get<ProjectSummary[]>('/projects'), api.get<RunSummary[]>('/runs')]).then(([p, r]) => {
      if (cancelled) return;
      setDyn({
        projects: p.ok && Array.isArray(p.body) ? p.body.slice(0, 8) : [],
        runs: r.ok && Array.isArray(r.body) ? r.body.filter((x) => x.kind !== 'STRATEGY_CHILD' && x.status === 'COMPLETED').slice(0, 6) : [],
      });
    });
    return () => { cancelled = true; };
  }, [open]);

  // `when` conditions read live state, so evaluate on open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupCommands(collectCommands(sources)), [sources, open]);

  const choose = useCallback((fn: () => void) => {
    onOpenChange(false);
    // Let the dialog release focus first so the command can open its own dialog or focus a field.
    window.setTimeout(fn, 60);
  }, [onOpenChange]);

  const item = 'flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm text-muted data-[selected=true]:bg-surface-3 data-[selected=true]:text-fg [&_svg]:shrink-0 [&_svg]:text-faint data-[selected=true]:[&_svg]:text-fg';
  const heading = '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-faint';

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="ds-overlay fixed inset-0 z-[80] bg-[var(--scrim)]" />
        <RD.Content aria-describedby={undefined} className="ds-dialog fixed left-1/2 top-[15vh] z-[81] w-[580px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-[10px] border border-line bg-surface focus-visible:outline-none">
          <RD.Title className="sr-only">Command palette</RD.Title>
          <Cmdk label="Command palette" loop vimBindings={false}>
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search size={16} className="shrink-0 text-faint" />
              <Cmdk.Input value={search} onValueChange={setSearch} placeholder="Search commands, projects and runs" style={{ outline: 'none' }} className="h-11 flex-1 bg-transparent text-sm text-fg placeholder:text-faint" />
              <Kbd>Esc</Kbd>
            </div>
            <Cmdk.List className={cn('max-h-[min(380px,55vh)] overflow-auto p-1.5', heading)}>
              <Cmdk.Empty className="px-3 py-8 text-center text-sm text-muted">No matching commands.</Cmdk.Empty>
              {groups.map(({ group, items }) => (
                <Cmdk.Group key={group} heading={group}>
                  {items.map((c: Command) => (
                    <Cmdk.Item key={c.id} value={`${group} ${c.title}`} keywords={c.keywords} onSelect={() => choose(c.run)} className={item}>
                      {c.icon}
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      {c.shortcut && <Shortcut keys={c.shortcut} />}
                    </Cmdk.Item>
                  ))}
                </Cmdk.Group>
              ))}
              {dyn.runs.length > 0 && (
                <Cmdk.Group heading="Recent runs">
                  {dyn.runs.map((r) => (
                    <Cmdk.Item key={r.runId} value={`Recent runs ${r.projectName ?? ''} ${r.kind} ${r.strategy} ${r.runId}`} onSelect={() => choose(() => navigate(`/runs/${r.runId}`))} className={item}>
                      <Activity size={ICON} />
                      <span className="min-w-0 flex-1 truncate">{r.projectName ?? 'Project'} <span className="text-faint">&middot; {r.kind.toLowerCase()} &middot; {r.strategy}</span></span>
                      <span className="shrink-0 font-mono text-xs text-faint tnum">p95 {formatMs(r.p95Ms)} &middot; {r.finishedAt ? relativeTime(r.finishedAt) : shortId(r.runId)}</span>
                    </Cmdk.Item>
                  ))}
                </Cmdk.Group>
              )}
              {dyn.projects.length > 0 && (
                <Cmdk.Group heading="Projects">
                  {dyn.projects.map((p) => (
                    <Cmdk.Item key={p.projectId} value={`Projects open ${p.name}`} onSelect={() => choose(() => navigate(`/p/${p.projectId}`))} className={item}>
                      <Folder size={ICON} />
                      <span className="min-w-0 flex-1 truncate">Open {p.name}</span>
                    </Cmdk.Item>
                  ))}
                </Cmdk.Group>
              )}
            </Cmdk.List>
            <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-xs text-faint">
              <span className="flex items-center gap-1"><Kbd>&uarr;</Kbd><Kbd>&darr;</Kbd>navigate</span>
              <span className="flex items-center gap-1"><Kbd>Enter</Kbd>run</span>
              <span className="ml-auto">Ctrl+K toggles</span>
            </div>
          </Cmdk>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useGlobalCommands();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const api_ = useMemo<PaletteApi>(() => ({ open: () => setOpen(true), toggle: () => setOpen((o) => !o) }), []);
  return (
    <Ctx.Provider value={api_}>
      {children}
      <Palette open={open} onOpenChange={setOpen} />
    </Ctx.Provider>
  );
}
