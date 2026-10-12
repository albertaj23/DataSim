import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { KeyRound, Link2, Table2 } from 'lucide-react';
import { memo } from 'react';
import type { Table } from '@datasim/shared';
import { formatNumber } from '../../lib/format';
import { cn, Pill } from '../../ui';
import { isFkColumn, isUniqueCol } from './logic';
import { HEADER_H, ROW_H, TABLE_W, typeLabel } from './layout';

export interface TableNodeData extends Record<string, unknown> {
  table: Table;
  /** Highest severity of problems on this table. */
  problem: 'error' | 'warning' | null;
  /** Table named by a failed provision. */
  failed: boolean;
}
export type TableFlowNode = Node<TableNodeData, 'table'>;

const handleCls = '!h-2 !w-2 !min-w-0 !border !border-line-strong !bg-surface opacity-0 transition-opacity group-hover/node:opacity-100';

function TableNodeImpl({ data, selected }: NodeProps<TableFlowNode>) {
  const t = data.table;
  const bad = data.failed || data.problem === 'error';
  return (
    <div
      style={{ width: TABLE_W }}
      className={cn(
        'group/node overflow-hidden rounded-[10px] border bg-surface text-fg transition-colors duration-150',
        selected ? 'border-accent ring-1 ring-accent/60' : bad ? 'border-bad ring-1 ring-bad/40' : data.problem === 'warning' ? 'border-warn/60' : 'border-line-strong hover:border-faint',
      )}
    >
      <div style={{ height: HEADER_H }} className="flex items-center gap-2 border-b border-line bg-surface-2 px-2.5">
        <Table2 size={14} className={bad ? 'text-bad' : 'text-muted'} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={t.name}>{t.name}</span>
        <Pill mono title="Seed rows">{formatNumber(t.seedRows)}</Pill>
      </div>
      <div className="pb-[6px]">
        {t.columns.map((c) => {
          const pk = t.primaryKey.includes(c.name);
          const fk = isFkColumn(t, c.name);
          return (
            <div key={c.name} style={{ height: ROW_H }} className="relative flex items-center gap-1.5 px-2.5 text-xs">
              <Handle id={`${c.name}:l`} type="source" position={Position.Left} className={handleCls} />
              <span className="flex w-3.5 shrink-0 justify-center">
                {pk ? <KeyRound size={12} className="text-warn" aria-label="Primary key" /> : fk ? <Link2 size={12} className="text-info" aria-label="Foreign key" /> : null}
              </span>
              <span className={cn('min-w-0 flex-1 truncate', pk ? 'font-medium text-fg' : 'text-fg')} title={c.name}>{c.name}</span>
              {isUniqueCol(t, c.name) && !pk && <span className="font-mono text-[9px] text-faint" title="Unique">UQ</span>}
              {!c.nullable && !pk && <span className="font-mono text-[9px] text-muted" title="NOT NULL">NN</span>}
              <span className="max-w-[88px] shrink-0 truncate font-mono text-[11px] text-faint" title={typeLabel(c.type)}>{typeLabel(c.type)}</span>
              <Handle id={`${c.name}:r`} type="source" position={Position.Right} className={handleCls} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const TableNode = memo(TableNodeImpl);

/** SVG end markers for FK edges: crow's foot (many) and double bar (exactly one). Rendered once inside the canvas wrapper. */
export function FkMarkers() {
  const common = { markerUnits: 'userSpaceOnUse' as const, markerWidth: 14, markerHeight: 14, viewBox: '0 0 14 14', refX: 14, refY: 7, orient: 'auto-start-reverse' as const };
  const stroke = { stroke: 'var(--muted)', strokeWidth: 1.25, fill: 'none', strokeLinecap: 'round' as const };
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <marker id="ds-fk-many" {...common}><path d="M1 7 L14 1.5 M1 7 L14 7 M1 7 L14 12.5" {...stroke} /></marker>
        <marker id="ds-fk-one" {...common}><path d="M9 2 L9 12 M13 2 L13 12" {...stroke} /></marker>
      </defs>
    </svg>
  );
}
