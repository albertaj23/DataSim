import { ChevronDown } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { Button, buttonClass, type ButtonVariant } from './Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './DropdownMenu';
import { cn } from './cn';

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('ds-skeleton h-4 rounded-md', className)} {...rest} />;
}

/** Keyboard key cap: <Kbd>Ctrl</Kbd><Kbd>K</Kbd> */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line bg-surface-2 px-1 font-mono text-[11px] text-muted', className)}>{children}</kbd>;
}

export interface SplitButtonAction { key: string; label: string; icon?: ReactNode; shortcut?: string; disabled?: boolean; onSelect: () => void }

export interface SplitButtonProps {
  /** Main click target. */
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Dropdown entries (can include the primary action again). */
  actions: SplitButtonAction[];
  variant?: Extract<ButtonVariant, 'primary' | 'secondary'>;
  size?: 'sm' | 'md';
  loading?: boolean;
  disabled?: boolean;
  menuLabel?: string;
}

export function SplitButton({ label, icon, onClick, actions, variant = 'primary', size = 'md', loading, disabled, menuLabel = 'More actions' }: SplitButtonProps) {
  return (
    <div className="inline-flex">
      <Button variant={variant} size={size} icon={icon} loading={loading} disabled={disabled} onClick={onClick} className="rounded-r-none">{label}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled || loading}
          aria-label={menuLabel}
          className={cn(buttonClass(variant, size, 'rounded-l-none border-l', true), variant === 'primary' ? 'border-l-accent-fg/25' : '-ml-px')}
        >
          <ChevronDown size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {actions.map((a) => (
            <DropdownMenuItem key={a.key} icon={a.icon} shortcut={a.shortcut} disabled={a.disabled} onSelect={a.onSelect}>{a.label}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  /** One line: what this is and why it is empty. */
  description?: ReactNode;
  icon?: ReactNode;
  /** Next-action buttons. */
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, actions, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-[10px] border border-dashed border-line px-6 py-12 text-center', className)}>
      {icon && <div className="text-faint">{icon}</div>}
      <div className="flex flex-col gap-1">
        <div className="text-base font-medium text-fg">{title}</div>
        {description && <div className="max-w-[420px] text-sm text-muted">{description}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
