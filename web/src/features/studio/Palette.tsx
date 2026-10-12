import { Search } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import type { NodeType } from '@datasim/shared';
import { NODE_LIMITS } from '@datasim/shared';
import { useDesignStore } from '../../lib/designStore';
import { Input, Tooltip, cn } from '../../ui';
import { useStudioActions } from './actions';
import { DND_MIME } from './Canvas';
import { NODE_ICON } from './NodeCard';
import { NODE_META, PALETTE_GROUPS, canAddNode, countOf } from './nodes';

function Item({ type }: { type: NodeType }) {
  const nodes = useDesignStore((s) => s.design.nodes);
  const actions = useStudioActions();
  const meta = NODE_META[type];
  const Icon = NODE_ICON[type];
  const can = canAddNode({ nodes }, type);
  const used = countOf({ nodes }, type);

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DND_MIME, type);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const el = (
    <button
      type="button"
      draggable={can.ok}
      onDragStart={onDragStart}
      onClick={() => actions.add(type)}
      disabled={!can.ok}
      data-testid={`palette-${type}`}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface-2 p-1.5 text-left transition-colors duration-150 ease-out',
        can.ok ? 'cursor-grab hover:border-line-strong hover:bg-surface-3 active:cursor-grabbing' : 'cursor-not-allowed opacity-50',
      )}
    >
      <span className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md border border-line bg-surface text-muted"><Icon size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{meta.label}</span>
        <span className="block truncate text-[11px] text-muted">{meta.blurb}</span>
      </span>
      <span className="shrink-0 font-mono text-[10px] text-faint tnum">{used}/{NODE_LIMITS[type]}</span>
    </button>
  );
  return can.ok ? el : <Tooltip content={can.reason} side="right">{<span className="block">{el}</span>}</Tooltip>;
}

export function Palette() {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => PALETTE_GROUPS.map((g) => ({
    ...g, types: g.types.filter((t) => !q || `${NODE_META[t].label} ${NODE_META[t].blurb} ${NODE_META[t].tag}`.toLowerCase().includes(q)),
  })).filter((g) => g.types.length), [q]);

  return (
    <aside aria-label="Component palette" className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="p-3 pb-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search components" aria-label="Search components" className="pl-8" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {groups.length === 0 && <p className="px-1 py-6 text-center text-xs text-faint">No component matches &ldquo;{query}&rdquo;.</p>}
        {groups.map((g) => (
          <section key={g.group} className="mb-3">
            <h3 className="mb-1.5 px-0.5 text-[11px] font-medium uppercase tracking-wide text-faint">{g.group}</h3>
            <div className="flex flex-col gap-1.5">{g.types.map((t) => <Item key={t} type={t} />)}</div>
          </section>
        ))}
      </div>
      <p className="border-t border-line px-3 py-2 text-[11px] leading-4 text-faint">Drag onto the canvas or click to add. Connect with the handles on a node&rsquo;s edges.</p>
    </aside>
  );
}
