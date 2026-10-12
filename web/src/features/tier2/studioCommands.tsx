// Studio commands for the palette. Registered once per project; every command reads live state when it runs.
import { useReactFlow } from '@xyflow/react';
import {
  Activity, Boxes, Database, FileCode, GitFork, Gauge, GitCompare, Image as ImageIcon, LayoutDashboard, PanelBottom, Play, Redo2, Save, Server, ShieldCheck, Square, Terminal, Undo2, Users, Workflow, Copy, Network, ListChecks,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ISOLATIONS, STRATEGY_VARIANTS, validateDesign, type NodeType, type ValidateResponse } from '@datasim/shared';
import { api, errorMessage } from '../../lib/api';
import { useDesignStore } from '../../lib/designStore';
import { useToast } from '../../ui';
import { useStudioActions } from '../studio/actions';
import { exportCanvasPng, exportDdl } from '../studio/exporters';
import { currentIsolation, currentStrategy, setIsolation, setStrategy } from '../studio/mutations';
import { canAddNode, NODE_META } from '../studio/nodes';
import { flushSave } from '../studio/persist';
import { isActive, useRunStore } from '../studio/runStore';
import type { useRunActions } from '../studio/runFlow';
import { PANEL_TABS, useStudioUi } from '../studio/studioUi';
import { registerCommands, useTier2Ui, type Command } from './commands';

const I = 16;
const NODE_ICON: Record<NodeType, typeof Users> = { users: Users, lb: Network, app: Server, redis: Boxes, mysql: Database };
const STRATEGY_HINT: Record<string, string> = { default: 'as written', naive: 'read then write', pessimistic: 'FOR UPDATE', optimistic: 'version check CAS', atomic: 'single UPDATE', serializable: 'SERIALIZABLE' };
const ui = () => useStudioUi.getState();
const design = () => useDesignStore.getState().design;
const idle = () => !isActive(useRunStore.getState());

export function useStudioCommands(projectId: string, name: string, run: ReturnType<typeof useRunActions>) {
  const toast = useToast();
  const rf = useReactFlow();
  const actions = useStudioActions();
  const live = useRef({ name, run, toast, rf, actions });
  live.current = { name, run, toast, rf, actions };

  useEffect(() => {
    const L = () => live.current;

    const validate = async () => {
      const client = validateDesign(design());
      const res = await api.post<ValidateResponse>(`/projects/${projectId}/validate`, { design: design() });
      const server = res.ok && Array.isArray(res.body.problems) ? res.body.problems : [];
      const all = [...client, ...server.filter((s) => !client.some((c) => c.code === s.code && c.message === s.message))];
      const errors = all.filter((p) => p.severity === 'error').length;
      if (!res.ok && res.status !== 0) L().toast.error('Server validation failed', errorMessage(res));
      else if (errors) L().toast.error(`${errors} error${errors === 1 ? '' : 's'} in the design`, all.find((p) => p.severity === 'error')!.message);
      else L().toast.success('Design is valid', all.length ? `${all.length} warning${all.length === 1 ? '' : 's'}` : 'No problems found');
    };

    const save = async () => {
      if (!(await flushSave())) { L().toast.error('Could not save', 'The draft was not saved.'); return; }
      const res = await api.post<{ revisionNo: number; created: boolean }>(`/projects/${projectId}/revisions`, {});
      if (!res.ok) { L().toast.error('Could not pin a revision', errorMessage(res)); return; }
      useDesignStore.getState().setRevisionNo(res.body.revisionNo);
      L().toast.success(res.body.created ? `Saved as rev ${res.body.revisionNo}` : `No changes since rev ${res.body.revisionNo}`);
    };

    const cmds: Command[] = [
      { id: 'run-load', title: 'Run load test', group: 'Run', icon: <Play size={I} />, shortcut: 'Ctrl+Enter', keywords: ['start', 'simulate', 'vus'], when: idle, run: () => void L().run.start('LOAD') },
      { id: 'run-capacity', title: 'Run capacity test', group: 'Run', icon: <Gauge size={I} />, keywords: ['usl', 'knee', 'scalability', 'steps'], when: idle, run: () => void L().run.start('CAPACITY') },
      { id: 'run-compare', title: 'Compare strategies', group: 'Run', icon: <GitCompare size={I} />, keywords: ['naive', 'atomic', 'variants'], when: idle, run: () => void L().run.compareStrategies() },
      { id: 'run-stop', title: 'Stop the running test', group: 'Run', icon: <Square size={I} />, keywords: ['cancel', 'abort'], when: () => !idle(), run: () => void L().run.cancel() },

      { id: 'validate', title: 'Validate design', group: 'Design', icon: <ShieldCheck size={I} />, keywords: ['check', 'problems', 'lint'], run: () => void validate() },
      { id: 'save', title: 'Save revision', group: 'Design', icon: <Save size={I} />, shortcut: 'Ctrl+S', keywords: ['pin', 'snapshot'], run: () => void save() },
      { id: 'undo', title: 'Undo', group: 'Design', icon: <Undo2 size={I} />, shortcut: 'Ctrl+Z', run: () => L().actions.undo() },
      { id: 'redo', title: 'Redo', group: 'Design', icon: <Redo2 size={I} />, shortcut: 'Ctrl+Shift+Z', run: () => L().actions.redo() },
      { id: 'layout', title: 'Auto layout canvas', group: 'Design', icon: <LayoutDashboard size={I} />, keywords: ['arrange', 'dagre', 'tidy'], run: () => L().actions.layout() },
      { id: 'duplicate', title: 'Duplicate selected component', group: 'Design', icon: <Copy size={I} />, shortcut: 'Ctrl+D', when: () => !!ui().selectedNode, run: () => { const id = ui().selectedNode; if (id) L().actions.duplicate(id); } },

      ...(['users', 'lb', 'app', 'redis', 'mysql'] as NodeType[]).map((type): Command => {
        const Icon = NODE_ICON[type];
        return { id: `add-${type}`, title: `Add ${NODE_META[type].label.toLowerCase()}`, group: 'Add component', icon: <Icon size={I} />, keywords: [type, NODE_META[type].blurb], when: () => canAddNode(design(), type).ok, run: () => { L().actions.add(type); } };
      }),

      ...STRATEGY_VARIANTS.map((s): Command => ({
        id: `strategy-${s}`, title: `Set strategy to ${s}`, group: 'Strategy', icon: <Workflow size={I} />, keywords: ['concurrency', 'variant', STRATEGY_HINT[s] ?? ''],
        when: () => currentStrategy(design()) !== null && currentStrategy(design()) !== s, run: () => { useDesignStore.getState().update((d) => setStrategy(d, s)); L().toast.info(`Strategy: ${s}`, STRATEGY_HINT[s]); },
      })),
      ...ISOLATIONS.map((iso): Command => ({
        id: `isolation-${iso}`, title: `Set isolation to ${iso}`, group: 'Isolation', icon: <Workflow size={I} />, keywords: ['transaction', 'level', 'rr', 'rc', 'serializable'],
        when: () => currentIsolation(design()) !== null && currentIsolation(design()) !== iso, run: () => { useDesignStore.getState().update((d) => setIsolation(d, iso)); L().toast.info(`Isolation: ${iso}`); },
      })),

      { id: 'open-schema', title: 'Open schema designer', group: 'Editors', icon: <Database size={I} />, keywords: ['tables', 'er', 'ddl', 'columns'], run: () => ui().openSchema() },
      { id: 'open-workload', title: 'Open workload editor', group: 'Editors', icon: <Users size={I} />, keywords: ['transactions', 'sql', 'steps', 'invariants', 'mix'], run: () => ui().openWorkload() },
      { id: 'normalize', title: 'Normalize schema (BCNF / 3NF assistant)', group: 'Editors', icon: <GitFork size={I} />, keywords: ['functional dependencies', 'fd', 'closure', 'keys', 'decompose'], run: () => { ui().openSchema(); useTier2Ui.getState().request('normalize'); } },
      { id: 'sql-console', title: 'Open SQL console (read-only)', group: 'Editors', icon: <Terminal size={I} />, keywords: ['query', 'select', 'explain', 'sandbox'], run: () => { ui().openSchema(); useTier2Ui.getState().request('query'); } },

      { id: 'panel-toggle', title: 'Toggle bottom panel', group: 'Panels', icon: <PanelBottom size={I} />, run: () => ui().togglePanel() },
      ...PANEL_TABS.map((t): Command => ({ id: `panel-${t}`, title: `Show ${t} panel`, group: 'Panels', icon: t === 'invariants' ? <ListChecks size={I} /> : <Activity size={I} />, run: () => ui().openPanel(t) })),

      { id: 'export-ddl', title: 'Export DDL (.sql)', group: 'Export', icon: <FileCode size={I} />, keywords: ['download', 'create table'], run: () => {
        if (design().schema.tables.length === 0) { L().toast.error('Nothing to export', 'The schema has no tables yet.'); return; }
        exportDdl(L().name, design());
      } },
      { id: 'export-png', title: 'Export canvas PNG', group: 'Export', icon: <ImageIcon size={I} />, keywords: ['image', 'topology', 'download'], run: () => { exportCanvasPng(L().rf, L().name).catch((e: Error) => L().toast.error('Could not export PNG', e.message)); } },
    ];
    return registerCommands('studio', cmds);
  }, [projectId]);
}
