import { forwardRef, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export const inputClass =
  'h-8 w-full rounded-md border border-line bg-surface px-2.5 text-sm text-fg placeholder:text-faint transition-colors duration-150 ease-out hover:border-line-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-45 aria-[invalid=true]:border-bad';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, mono, invalid, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(inputClass, mono && 'font-mono tnum', className)} {...rest} />;
});

export interface NumberFieldProps {
  value: number;
  /** Called on blur / Enter / arrow keys with a clamped, step-aligned number. */
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Suffix shown inside the field: ms, s, VUs, %. */
  unit?: string;
  /** Digits kept when committing (default 0 for integer steps, else derived from step). */
  decimals?: number;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

function decimalsOf(step: number) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1]!.length : 0;
}

/** Compact mono number input with a unit suffix. Edits are local until blur/Enter; Esc reverts. */
export function NumberField({ value, onCommit, min, max, step = 1, unit, decimals, disabled, invalid, id, className, ...aria }: NumberFieldProps) {
  const dp = decimals ?? decimalsOf(step);
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const commit = (raw: string) => {
    const n = Number(raw.trim());
    if (raw.trim() === '' || !Number.isFinite(n)) { setText(String(value)); return; }
    const v = Number(clamp(n).toFixed(dp));
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  const nudge = (dir: 1 | -1) => commit(String(Number(text) + dir * step));

  return (
    <div className={cn('relative w-full', className)}>
      <input
        id={id}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        {...aria}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(text); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Escape') { setText(String(value)); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1); }
        }}
        style={unit ? { paddingRight: 14 + unit.length * 7 } : undefined}
        className={cn(inputClass, 'text-right font-mono tnum')}
      />
      {unit && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-faint">{unit}</span>}
    </div>
  );
}

/* Form layout helpers ------------------------------------------------------------------ */

export function Label({ className, ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-xs text-muted', className)} {...rest} />;
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Render function gets the generated id so the label is associated with the control. */
  children: ReactNode | ((id: string) => ReactNode);
  className?: string;
}

/** Stacked label + control + hint/error. */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label htmlFor={id}>{label}</Label>
      {typeof children === 'function' ? children(id) : children}
      {error ? <div className="text-xs text-bad">{error}</div> : hint ? <div className="text-xs text-faint">{hint}</div> : null}
    </div>
  );
}

/** Compact inspector row: label on the left (fixed 112px), control on the right. */
export function FormRow({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode | ((id: string) => ReactNode); className?: string }) {
  const id = useId();
  return (
    <div className={cn('grid grid-cols-[112px_1fr] items-center gap-x-2 gap-y-0.5 py-1', className)}>
      <Label htmlFor={id} className="truncate">{label}</Label>
      <div className="min-w-0">{typeof children === 'function' ? children(id) : children}</div>
      {hint && <div className="col-start-2 text-xs text-faint">{hint}</div>}
    </div>
  );
}

export function SectionHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-8 items-center justify-between', className)}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
      {action}
    </div>
  );
}
