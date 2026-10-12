import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'accent';

const tones: Record<Tone, string> = {
  neutral: 'border-line bg-surface-3 text-muted',
  green: 'border-ok/30 bg-ok/10 text-ok',
  amber: 'border-warn/30 bg-warn/10 text-warn',
  red: 'border-bad/30 bg-bad/10 text-bad',
  blue: 'border-info/30 bg-info/10 text-info',
  accent: 'border-accent/30 bg-accent/10 text-accent',
};
export const toneText: Record<Tone, string> = { neutral: 'text-muted', green: 'text-ok', amber: 'text-warn', red: 'text-bad', blue: 'text-info', accent: 'text-accent' };
export const toneBg: Record<Tone, string> = { neutral: 'bg-faint', green: 'bg-ok', amber: 'bg-warn', red: 'bg-bad', blue: 'bg-info', accent: 'bg-accent' };

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Geist Mono with tabular numerals: for metrics like "p95 41ms". */
  mono?: boolean;
  icon?: ReactNode;
}

export function Pill({ tone = 'neutral', mono, icon, className, children, ...rest }: PillProps) {
  return (
    <span
      className={cn('inline-flex h-[18px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 text-[11px] leading-none', tones[tone], mono && 'font-mono tnum', className)}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}

export type StatusKind = 'ok' | 'warn' | 'bad' | 'info' | 'idle';
const dot: Record<StatusKind, string> = { ok: 'bg-ok text-ok', warn: 'bg-warn text-warn', bad: 'bg-bad text-bad', info: 'bg-info text-info', idle: 'bg-faint text-faint' };

/** 8px health dot. `pulse` draws a soft ring (running). */
export function StatusDot({ status = 'idle', pulse, label, className }: { status?: StatusKind; pulse?: boolean; label?: string; className?: string }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', dot[status], className)}
      style={pulse ? { animation: 'ds-pulse-ring 1.4s ease-out infinite' } : undefined}
    />
  );
}
