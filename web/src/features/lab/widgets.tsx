// Small presentational pieces shared by the Concurrency Lab and the Transaction Stepper.
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../../ui';

/** Flat bordered section with a compact header row. */
export function Panel({ title, subtitle, actions, children, className, bodyClassName, flush }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; /** No body padding. */ flush?: boolean;
}) {
  return (
    <section className={cn('min-w-0 rounded-[10px] border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex min-h-10 items-center justify-between gap-3 border-b border-line px-3.5 py-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-fg">{title}</h2>
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && 'p-3.5', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Toggle button with aria-pressed: the keyboard-friendly stand-in for a checkbox group. */
export function ToggleChip({ pressed, onPressedChange, children, disabled, title }: {
  pressed: boolean; onPressedChange: (v: boolean) => void; children: ReactNode; disabled?: boolean; title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex h-7 items-center rounded-md border px-2.5 font-mono text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        pressed ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line bg-surface-2 text-muted hover:border-line-strong hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

/** Small segmented control (radio semantics). */
export function Segmented<V extends string>({ value, onChange, options, label }: {
  value: V; onChange: (v: V) => void; options: { value: V; label: string }[]; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-6 rounded px-2.5 text-xs transition-colors duration-150',
            value === o.value ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Inline error / warning line with an icon. */
export function Notice({ tone = 'bad', children }: { tone?: 'bad' | 'warn'; children: ReactNode }) {
  return (
    <div role="alert" className={cn('flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs', tone === 'bad' ? 'border-bad/30 bg-bad/10 text-bad' : 'border-warn/30 bg-warn/10 text-warn')}>
      <AlertTriangle size={14} className="mt-px shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** Footnote mapping legacy table names to Review 1 entities. */
export function LegacyNames({ className }: { className?: string }) {
  return (
    <p className={cn('text-xs text-faint', className)}>
      Legacy table names: <span className="font-mono">account</span> = user_account, <span className="font-mono">device</span> = client,{' '}
      <span className="font-mono">playback_session</span> = allocation, <span className="font-mono">playback_event</span> = operation_event, <span className="font-mono">song</span> = resource,{' '}
      <span className="font-mono">experiment_run</span> = experiment_run. These tables live in the <span className="font-mono">datasim</span> database and are not renamed.
    </p>
  );
}

/** Small caption under a results table. */
export function TableNote({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-xs text-faint">{children}</p>;
}

/** Determinate progress bar. */
export function ProgressBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
      <div className="h-full rounded-full bg-info transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}
