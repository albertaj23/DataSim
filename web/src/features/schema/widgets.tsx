// Small editor widgets shared by the Schema Designer and the Workload Editor.
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn, Popover, PopoverContent, PopoverTrigger, Tooltip } from '../../ui';

/** Borderless-until-hover input for dense grids (the kit's Input is 32px tall). */
export const cellInput =
  'h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-sm text-fg placeholder:text-faint transition-colors duration-150 ease-out hover:border-line focus-visible:border-accent focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent aria-[invalid=true]:border-bad disabled:opacity-45';

export interface TextCommitProps {
  value: string;
  onCommit: (v: string) => void;
  /** Return a message to block the commit and show it live. */
  validate?: (v: string) => string | null;
  mono?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  /** Use the grid-cell look instead of the form look. */
  cell?: boolean;
  /** Hide the inline error text (the caller shows it elsewhere). */
  hideError?: boolean;
}

const formInput =
  'h-8 w-full min-w-0 rounded-md border border-line bg-surface px-2.5 text-sm text-fg placeholder:text-faint transition-colors duration-150 ease-out hover:border-line-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent aria-[invalid=true]:border-bad disabled:opacity-45';

/** Text input that edits locally, validates live and commits on blur / Enter. Esc reverts. */
export function TextCommit({ value, onCommit, validate, mono, placeholder, disabled, className, cell, hideError, ...aria }: TextCommitProps) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const error = validate ? validate(text) : null;
  const commit = () => {
    if (text === value) return;
    if (error) return;
    onCommit(text);
  };
  return (
    <div className="min-w-0 flex-1">
      <input
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-label={aria['aria-label']}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Escape') { e.stopPropagation(); setText(value); (e.target as HTMLInputElement).blur(); }
        }}
        className={cn(cell ? cellInput : formInput, mono && 'font-mono', className)}
      />
      {error && !hideError && <div className="mt-0.5 text-[11px] leading-4 text-bad">{error}{text !== value ? ' (not applied)' : ''}</div>}
    </div>
  );
}

/** Square-ish toggle chip (NN, PK, UQ, AI ...). */
export function FlagToggle({ on, onClick, label, title, disabled, tone = 'accent' }: { on: boolean; onClick: () => void; label: string; title: ReactNode; disabled?: boolean; tone?: 'accent' | 'warn' }) {
  return (
    <Tooltip content={title}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={typeof title === 'string' ? title : label}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'h-6 min-w-[26px] shrink-0 rounded border px-1 font-mono text-[10px] font-medium leading-none transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-35',
          on
            ? tone === 'warn' ? 'border-warn/40 bg-warn/15 text-warn' : 'border-accent/40 bg-accent/15 text-accent'
            : 'border-line bg-transparent text-faint hover:border-line-strong hover:text-muted',
        )}
      >
        {label}
      </button>
    </Tooltip>
  );
}

/** Ordered multi-select of column names in a popover. The click order is the key order. */
export function ColumnPicker({ options, value, onChange, placeholder = 'Select columns', invalid, 'aria-label': ariaLabel }: { options: string[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string; invalid?: boolean; 'aria-label'?: string }) {
  const toggle = (c: string) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-line bg-surface px-2.5 text-left text-sm transition-colors duration-150 ease-out hover:border-line-strong aria-[invalid=true]:border-bad"
        >
          <span className={cn('truncate font-mono text-xs', value.length === 0 && 'font-sans text-sm text-faint')}>{value.length ? value.join(', ') : placeholder}</span>
          <ChevronDown size={14} className="shrink-0 text-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent width={240} className="p-1">
        <div className="max-h-[240px] overflow-auto">
          {options.length === 0 && <div className="px-2 py-1.5 text-xs text-faint">No columns</div>}
          {options.map((c) => {
            const idx = value.indexOf(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                disabled={idx >= 0 && value.length === 1}
                title={idx >= 0 && value.length === 1 ? 'At least one column is required' : undefined}
                className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', idx >= 0 ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong')}>
                  {idx >= 0 && <Check size={12} strokeWidth={2.5} />}
                </span>
                <span className="flex-1 truncate font-mono text-xs">{c}</span>
                {idx >= 0 && value.length > 1 && <span className="font-mono text-[11px] text-faint">{idx + 1}</span>}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Collapsible-less titled block used in side panels. */
export function PanelSection({ title, action, children, count }: { title: string; action?: ReactNode; children: ReactNode; count?: number }) {
  return (
    <section className="border-t border-line px-4 py-3 first:border-t-0">
      <div className="mb-2 flex h-6 items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
          {title}
          {count !== undefined && <span className="rounded bg-surface-3 px-1 font-mono text-[11px] normal-case tracking-normal text-muted">{count}</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
