import { useReactFlow } from '@xyflow/react';
import {
  CircleAlert, CircleCheck, Copy, EllipsisVertical, FileCode, Gauge, GitCompare, Image as ImageIcon, Loader, Play, Save, ShieldCheck, Square, TriangleAlert,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Problem } from '@datasim/shared';
import { api, errorMessage } from '../../lib/api';
import { useDesignStore } from '../../lib/designStore';
import { relativeTime } from '../../lib/format';
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, FormRow, IconButton, Input, NumberField, Pill, Popover, PopoverContent, PopoverTrigger,
  Select, SplitButton, Tooltip, useToast,
} from '../../ui';
import { useStudioActions } from './actions';
import { exportCanvasPng, exportDdl } from './exporters';
import { flushSave, lastSaveError } from './persist';
import { problemTarget, problemWhere } from './problems';
import { currentIsolation, currentStrategy, setIsolation, setStrategy } from './mutations';
import { ISOLATION_OPTIONS, STRATEGY_OPTIONS } from './nodes';
import { isActive, useRunStore } from './runStore';
import { useStudioUi } from './studioUi';
import { useForeignRun, type useRunActions } from './runFlow';

const update = (fn: Parameters<ReturnType<typeof useDesignStore.getState>['update']>[0]) => useDesignStore.getState().update(fn);

// ---------------------------------------------------------------- breadcrumb with inline rename
function Breadcrumb({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setText(name), [name]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  const commit = () => { setEditing(false); const t = text.trim(); if (t && t !== name) onRename(t); else setText(name); };
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <Link to="/" className="text-muted transition-colors hover:text-fg">Projects</Link>
      <span className="text-faint">/</span>
      {editing ? (
        <Input
          ref={ref} value={text} maxLength={120} aria-label="Project name" className="h-7 w-[240px]"
          onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') { setText(name); setEditing(false); } }}
        />
      ) : (
        <Tooltip content="Rename">
          <button type="button" onClick={() => setEditing(true)} className="min-w-0 truncate rounded px-1 py-0.5 font-medium text-fg transition-colors hover:bg-surface-2" data-testid="project-name">{name}</button>
        </Tooltip>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------- revision pill + save
function RevisionPill() {
  const revisionNo = useDesignStore((s) => s.revisionNo);
  const status = useDesignStore((s) => s.saveStatus);
  const pinnedDirty = useDesignStore((s) => s.pinnedDirty);
  const text = status === 'saving' ? 'saving' : status === 'error' ? 'save failed' : status === 'dirty' ? 'unsaved' : pinnedDirty ? 'draft saved' : 'saved';
  const tone = status === 'error' ? 'red' : status === 'saving' || status === 'dirty' ? 'blue' : pinnedDirty ? 'neutral' : 'green';
  return (
    <Tooltip content={status === 'error' ? `Autosave failed: ${lastSaveError() || 'unknown error'}. Click to retry.` : 'Edits autosave to the draft. Save pins an immutable revision; every run pins one too.'}>
      <button type="button" onClick={() => status === 'error' && void flushSave()} className="rounded-full" data-testid="revision-pill">
        <Pill tone={tone} mono className="h-5 px-2" icon={status === 'saving' ? <Loader size={11} className="ds-spin" /> : undefined}>
          {revisionNo ? `rev ${revisionNo}` : 'no revision'} &middot; {text}
        </Pill>
      </button>
    </Tooltip>
  );
}

function SaveButton({ projectId }: { projectId: string }) {
  const pinnedDirty = useDesignStore((s) => s.pinnedDirty);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (!(await flushSave())) { toast.error('Could not save', 'The draft was not saved.'); return; }
      const res = await api.post<{ revisionNo: number; created: boolean }>(`/projects/${projectId}/revisions`, {});
      if (!res.ok) { toast.error('Could not pin a revision', errorMessage(res)); return; }
      useDesignStore.getState().setRevisionNo(res.body.revisionNo);
      toast.success(res.body.created ? `Saved as rev ${res.body.revisionNo}` : `No changes since rev ${res.body.revisionNo}`);
    } finally { setBusy(false); }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });
  return <IconButton label="Save revision" shortcut="Ctrl+S" icon={<Save size={16} />} loading={busy} disabled={!pinnedDirty && !busy} onClick={() => void save()} />;
}

// ---------------------------------------------------------------- validate
function ValidateButton({ problems, onOpen, checking }: { problems: Problem[]; onOpen: () => void; checking: boolean }) {
  const design = useDesignStore((s) => s.design);
  const actions = useStudioActions();
  const ui = useStudioUi.getState;
  const [open, setOpen] = useState(false);
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warns = problems.length - errors;
  const go = (p: Problem) => {
    const t = problemTarget(p);
    setOpen(false);
    if (t.kind === 'node') { ui().selectNode(t.id); actions.center(t.id); }
    else if (t.kind === 'edge') ui().selectEdge(t.id);
    else if (t.kind === 'table') ui().openSchema(t.table);
    else if (t.kind === 'workload') ui().openWorkload();
  };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) onOpen(); }}>
      <PopoverTrigger asChild>
        <Button size="sm" data-testid="validate" icon={errors ? <CircleAlert size={14} className="text-bad" /> : warns ? <TriangleAlert size={14} className="text-warn" /> : <ShieldCheck size={14} className="text-ok" />}>
          Validate
          {problems.length > 0 && <Pill tone={errors ? 'red' : 'amber'} mono>{problems.length}</Pill>}
        </Button>
      </PopoverTrigger>
      <PopoverContent width={380} className="p-0" align="end">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-sm font-medium">{problems.length === 0 ? 'No problems' : `${errors} error${errors === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}`}</span>
          {checking && <span className="flex items-center gap-1 text-xs text-muted"><Loader size={12} className="ds-spin" />Checking with MySQL</span>}
        </div>
        {problems.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted">Topology, schema and workload pass every static check{checking ? '' : ' and the MySQL dry run'}.</p>
        ) : (
          <ul className="max-h-[320px] overflow-auto py-1">
            {problems.map((p, i) => (
              <li key={`${p.code}-${i}`}>
                <button type="button" onClick={() => go(p)} className="flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-3">
                  {p.severity === 'error' ? <CircleAlert size={14} className="mt-0.5 shrink-0 text-bad" /> : <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warn" />}
                  <span className="min-w-0">
                    <span className="block text-sm text-fg">{p.message}</span>
                    {problemTarget(p).kind !== 'none' && <span className="block font-mono text-[11px] text-faint">{problemWhere(p, design)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------- quick selectors
function QuickSelectors() {
  const strategy = useDesignStore((s) => currentStrategy(s.design));
  const isolation = useDesignStore((s) => currentIsolation(s.design));
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <span className="hidden xl:inline">Strategy</span>
        <Select size="sm" aria-label="Concurrency strategy" value={strategy ?? 'default'} disabled={!strategy} options={STRATEGY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} onValueChange={(v) => update((d) => setStrategy(d, v))} className="w-[112px]" />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <span className="hidden xl:inline">Isolation</span>
        <Select size="sm" aria-label="Isolation level" value={isolation ?? 'REPEATABLE READ'} disabled={!isolation} options={ISOLATION_OPTIONS} onValueChange={(v) => update((d) => setIsolation(d, v))} className="w-[158px]" />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- SLO chip
function SloChip() {
  const slo = useDesignStore((s) => s.design.slo);
  const verdict = useRunStore((s) => (isActive(s) ? null : s.report?.slo ?? null));
  const run = useRunStore((s) => (isActive(s) ? null : s.report?.run ?? null));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-testid="slo-chip" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 text-xs text-muted transition-colors hover:border-line-strong hover:text-fg">
          <Gauge size={14} />
          <span className="font-mono tnum">p95 &le; {slo.p95Ms} ms &middot; err &le; {slo.maxErrorPct}%</span>
          {verdict && <Pill tone={verdict.pass ? 'green' : 'red'} className="font-medium">{verdict.pass ? 'PASS' : 'FAIL'}</Pill>}
        </button>
      </PopoverTrigger>
      <PopoverContent width={320} align="end">
        <div className="mb-1 text-sm font-medium">Service level objective</div>
        <p className="mb-2 text-xs text-muted">A run passes when overall p95 and the error rate stay inside these limits.</p>
        <FormRow label="p95 target">{(id) => <NumberField id={id} value={slo.p95Ms} min={1} max={60000} unit="ms" onCommit={(p95Ms) => update((d) => { d.slo.p95Ms = p95Ms; })} />}</FormRow>
        <FormRow label="Max errors">{(id) => <NumberField id={id} value={slo.maxErrorPct} min={0} max={100} step={0.1} unit="%" onCommit={(maxErrorPct) => update((d) => { d.slo.maxErrorPct = maxErrorPct; })} />}</FormRow>
        {verdict && run && (
          <div className="mt-2 border-t border-line pt-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs">
              {verdict.pass ? <CircleCheck size={14} className="text-ok" /> : <CircleAlert size={14} className="text-bad" />}
              <span className="text-fg">Last run: {verdict.pass ? 'pass' : 'fail'}</span>
              <span className="ml-auto text-faint">{relativeTime(run.finishedAt)}</span>
            </div>
            {verdict.reasons.length > 0 ? <ul className="flex flex-col gap-0.5 text-xs text-muted">{verdict.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="text-xs text-muted">p95 {Math.round(run.p95Ms)} ms, within the objective.</p>}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------- overflow
function Overflow({ projectId, name }: { projectId: string; name: string }) {
  const rf = useReactFlow();
  const toast = useToast();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <Tooltip content="More"><DropdownMenuTrigger asChild><IconButton label="More actions" icon={<EllipsisVertical size={16} />} /></DropdownMenuTrigger></Tooltip>
      <DropdownMenuContent>
        <DropdownMenuItem icon={<FileCode size={14} />} onSelect={() => {
          const design = useDesignStore.getState().design;
          if (design.schema.tables.length === 0) { toast.error('Nothing to export', 'The schema has no tables yet.'); return; }
          exportDdl(name, design);
        }}>Export DDL (.sql)</DropdownMenuItem>
        <DropdownMenuItem icon={<ImageIcon size={14} />} onSelect={() => { exportCanvasPng(rf, name).catch((e: Error) => toast.error('Could not export PNG', e.message)); }}>Export canvas PNG</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Copy size={14} />} onSelect={async () => {
          if (!(await flushSave())) { toast.error('Could not save the draft first'); return; }
          const res = await api.post<{ projectId: string }>(`/projects/${projectId}/duplicate`);
          if (!res.ok) { toast.error('Could not duplicate', errorMessage(res)); return; }
          toast.success('Design duplicated');
          navigate(`/p/${res.body.projectId}`);
        }}>Duplicate design</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------- bar
export interface TopBarProps {
  projectId: string;
  name: string;
  onRename: (name: string) => void;
  problems: Problem[];
  checking: boolean;
  onValidate: () => void;
  run: ReturnType<typeof useRunActions>;
}

export function TopBar({ projectId, name, onRename, problems, checking, onValidate, run }: TopBarProps) {
  const active = useRunStore(isActive);
  const foreign = useForeignRun(projectId);
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Breadcrumb name={name} onRename={onRename} />
        <RevisionPill />
        <SaveButton projectId={projectId} />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        <ValidateButton problems={problems} onOpen={onValidate} checking={checking} />
        <span className="h-5 w-px bg-line" />
        <QuickSelectors />
        <span className="h-5 w-px bg-line" />
        <SloChip />
        {foreign && !active && (
          <Tooltip content="Only one run can be active at a time. Wait for it to finish, then run this project."><span><Pill tone="amber" data-testid="foreign-run" icon={<Loader size={11} className="ds-spin" />}>Another project is running</Pill></span></Tooltip>
        )}
        {active ? (
          <Button variant="danger" icon={<Square size={14} />} onClick={() => void run.cancel()} data-testid="stop-run">Stop</Button>
        ) : (
          <SplitButton
            label="Run" icon={<Play size={14} />} disabled={foreign} onClick={() => void run.start('LOAD')} menuLabel="Run options"
            actions={[
              { key: 'load', label: 'Load test', icon: <Play size={14} />, shortcut: 'Ctrl+Enter', onSelect: () => void run.start('LOAD') },
              { key: 'capacity', label: 'Capacity test', icon: <Gauge size={14} />, onSelect: () => void run.start('CAPACITY') },
              { key: 'compare', label: 'Compare strategies', icon: <GitCompare size={14} />, onSelect: () => void run.compareStrategies() },
            ]}
          />
        )}
        <Overflow projectId={projectId} name={name} />
      </div>
    </header>
  );
}
