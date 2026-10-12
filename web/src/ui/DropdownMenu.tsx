import * as RM from '@radix-ui/react-dropdown-menu';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from './cn';

export const DropdownMenu = RM.Root;
export const DropdownMenuTrigger = RM.Trigger;
export const DropdownMenuSeparator = () => <RM.Separator className="-mx-1 my-1 h-px bg-line" />;
export const DropdownMenuLabel = ({ children }: { children: ReactNode }) => (
  <RM.Label className="px-2 py-1 text-[11px] uppercase tracking-wide text-faint">{children}</RM.Label>
);

export function DropdownMenuContent({ className, align = 'end', children, ...rest }: ComponentPropsWithoutRef<typeof RM.Content>) {
  return (
    <RM.Portal>
      <RM.Content align={align} sideOffset={6} collisionPadding={8} className={cn('z-[70] min-w-[180px] rounded-lg border border-line bg-surface-2 p-1', className)} {...rest}>
        {children}
      </RM.Content>
    </RM.Portal>
  );
}

export interface DropdownMenuItemProps extends Omit<ComponentPropsWithoutRef<typeof RM.Item>, 'onSelect'> {
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  onSelect?: () => void;
}

/** `onSelect` fires on click or Enter. Keep it as a plain handler (no event arg). */
export function DropdownMenuItem({ icon, shortcut, danger, onSelect, className, children, ...rest }: DropdownMenuItemProps) {
  return (
    <RM.Item
      onSelect={() => onSelect?.()}
      className={cn(
        'flex h-7 cursor-default select-none items-center gap-2 rounded-md px-2 text-sm outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3',
        danger ? 'text-bad' : 'text-fg',
        className,
      )}
      {...rest}
    >
      {icon && <span className={cn('flex w-4 justify-center', danger ? 'text-bad' : 'text-muted')}>{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="font-mono text-[11px] text-faint">{shortcut}</span>}
    </RM.Item>
  );
}
