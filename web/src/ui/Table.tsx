import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from './cn';

/** Compact data table. Wrap in a bounded-height parent: the header sticks inside the scroll box. */
export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-auto rounded-lg border border-line bg-surface">
      <table className={cn('w-full border-collapse text-left text-sm', className)} {...rest}>{children}</table>
    </div>
  );
}

export const THead = ({ children }: { children: ReactNode }) => <thead className="sticky top-0 z-[1] bg-surface-2">{children}</thead>;
export const TBody = ({ children }: { children: ReactNode }) => <tbody className="divide-y divide-line">{children}</tbody>;

export function TR({ className, interactive, selected, ...rest }: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean; selected?: boolean }) {
  return <tr className={cn('h-8 transition-colors duration-150', interactive && 'cursor-pointer hover:bg-surface-2', selected && 'bg-accent/5', className)} {...rest} />;
}

export function TH({ className, align, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return <th className={cn('h-8 whitespace-nowrap border-b border-line px-3 text-xs font-medium text-muted', align === 'right' && 'text-right', align === 'center' && 'text-center', className)} {...rest} />;
}

export function TD({ className, align, mono, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center'; mono?: boolean }) {
  return <td className={cn('px-3 text-fg', align === 'right' && 'text-right', align === 'center' && 'text-center', mono && 'font-mono tnum', className)} {...rest} />;
}

export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string = string> { key: K; dir: SortDir }

/** Clickable header cell. Keep `sort` in your own state; toggle with `nextSort`. */
export function SortableTH<K extends string>({ label, sortKey, sort, onSort, align }: { label: ReactNode; sortKey: K; sort: SortState<K> | null; onSort: (s: SortState<K>) => void; align?: 'left' | 'right' }) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TH align={align} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(nextSort(sort, sortKey))}
        className={cn('inline-flex items-center gap-1 transition-colors hover:text-fg', active && 'text-fg', align === 'right' && 'flex-row-reverse')}
      >
        {label}
        <Icon size={12} className={active ? 'text-accent' : 'text-faint'} />
      </button>
    </TH>
  );
}

export function nextSort<K extends string>(cur: SortState<K> | null, key: K): SortState<K> {
  if (cur?.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

/** Sorts a copy by a value picker; strings compare locale-aware, null sorts last. */
export function sortRows<T, K extends string>(rows: T[], sort: SortState<K> | null, pick: (row: T, key: K) => string | number | null | undefined): T[] {
  if (!sort) return rows;
  const m = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = pick(a, sort.key), y = pick(b, sort.key);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * m;
  });
}
