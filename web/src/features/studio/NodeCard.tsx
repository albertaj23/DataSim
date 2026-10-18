import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { CircleCheck, Copy, Database, EllipsisVertical, Loader, Server, Settings2, Split, Trash2, TriangleAlert, Users, Zap, type LucideIcon } from 'lucide-react';
import { createContext, memo, useContext } from 'react';
import type { NodeType } from '@datasim/shared';
import { useDesignStore } from '../../lib/designStore';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Pill, StatusDot, Tooltip, cn, type StatusKind } from '../../ui';
import { useStudioActions } from './actions';
import { NODE_META, configPills, livePills, nodeSubtitle } from './nodes';
import { isActive, useRunStore } from './runStore';

export const NODE_ICON: Record<NodeType, LucideIcon> = {
  users: Users, lb: Split, app: Server, redis: Zap, mysql: Database,
};

/** nodeId -> worst validation severity, provided by the Studio so cards do not each re-run validation. */
export const NodeHealthContext = createContext<Map<string, 'error' | 'warning'>>(new Map());

export type CardNode = Node<Record<string, never>, 'card'>;

function NodeCardImpl({ id, selected }: NodeProps<CardNode>) {
  const node = useDesignStore((s) => s.design.nodes.find((n) => n.id === id));
  const live = useRunStore((s) => s.liveNodes[id]);
  const running = useRunStore(isActive);
  const bottleneck = useRunStore((s) => (s.report?.bottleneck?.nodeId === id ? s.report.bottleneck : null));
  const health = useContext(NodeHealthContext).get(id);
  const actions = useStudioActions();
  if (!node) return null;

  const meta = NODE_META[node.type];
  const Icon = NODE_ICON[node.type];
  const pills = running && live ? livePills(node.type, live) : [];
  const rest = pills.length ? pills : configPills(node).map((text) => ({ text, tone: 'neutral' as const }));
  const status: StatusKind = bottleneck ? (bottleneck.severity === 'critical' ? 'bad' : 'warn') : health === 'error' ? 'bad' : health === 'warning' ? 'warn' : running ? 'info' : 'ok';
  const tone = bottleneck ? (bottleneck.severity === 'critical' ? 'bad' : 'warn') : null;

  return (
    <div
      data-testid={`node-${node.type}`}
      className={cn(
        'relative h-16 w-[224px] rounded-lg border bg-[var(--card-bg)] transition-[border-color,box-shadow] duration-150 ease-out',
        selected ? 'border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_20%,transparent)]' : tone === 'bad' ? 'border-bad shadow-[0_0_0_3px_color-mix(in_srgb,var(--bad)_16%,transparent)]' : tone === 'warn' ? 'border-warn shadow-[0_0_0_3px_color-mix(in_srgb,var(--warn)_16%,transparent)]' : 'border-[var(--card-line)] hover:border-line-strong',
      )}
    >
      {node.type !== 'users' && <Handle type="target" position={Position.Left} className="ds-handle" />}
      <Handle type="source" position={Position.Right} className={cn('ds-handle', (node.type === 'redis' || node.type === 'mysql') && 'ds-handle-off')} isConnectable={node.type !== 'redis' && node.type !== 'mysql'} />

      <div className="flex h-full">
        <div className="flex w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-l-[7px] border-r border-[var(--card-line)] bg-[var(--tile-bg)]">
          <Icon size={18} className="text-muted" />
          <span className="font-mono text-[10px] leading-none text-muted">{meta.tag}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 pl-2.5 pr-1">
          <div className="flex items-center gap-1">
            <Tooltip content={node.name} side="top">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{node.name}</span>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={`${node.name} menu`} className="nodrag nopan flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-surface-3 hover:text-fg data-[state=open]:bg-surface-3 data-[state=open]:text-fg">
                  <EllipsisVertical size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem icon={<Settings2 size={14} />} onSelect={() => actions.configure(id)}>Configure</DropdownMenuItem>
                <DropdownMenuItem icon={<Copy size={14} />} shortcut="Ctrl+D" onSelect={() => actions.duplicate(id)}>Duplicate</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<Trash2 size={14} />} danger shortcut="Del" onSelect={() => actions.remove([id])}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] leading-4 text-muted">
            <StatusDot status={status} pulse={running && !bottleneck} />
            <span className="min-w-0 truncate">{nodeSubtitle(node)}</span>
            {running ? <Loader size={12} className="ds-spin shrink-0 text-info" aria-label="running" />
              : health ? <TriangleAlert size={12} className={cn('shrink-0', health === 'error' ? 'text-bad' : 'text-warn')} aria-label={health === 'error' ? 'has errors' : 'has warnings'} />
              : <CircleCheck size={12} className="shrink-0 text-ok" aria-label="valid" />}
          </div>
        </div>
      </div>

      {/* Pills straddle the bottom border at the right, like the Argo CD tree. */}
      <div className="pointer-events-none absolute -bottom-[9px] right-2 flex items-center gap-1">
        {bottleneck && (
          <Tooltip content={bottleneck.reason}>
            <span className="pointer-events-auto rounded-full bg-bg"><Pill tone={bottleneck.severity === 'critical' ? 'red' : 'amber'}>bottleneck</Pill></span>
          </Tooltip>
        )}
        {rest.map((p) => (
          <span key={p.text} className="rounded-full bg-bg"><Pill mono tone={p.tone ?? 'neutral'}>{p.text}</Pill></span>
        ))}
      </div>
    </div>
  );
}

export const NodeCard = memo(NodeCardImpl);
