import * as RP from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import { cn } from './cn';

export const Popover = RP.Root;
export const PopoverTrigger = RP.Trigger;
export const PopoverClose = RP.Close;

export interface PopoverContentProps {
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  width?: number;
  className?: string;
}

/** Usage: <Popover><PopoverTrigger asChild><Button/></PopoverTrigger><PopoverContent>..</PopoverContent></Popover> */
export function PopoverContent({ children, side = 'bottom', align = 'start', width = 280, className }: PopoverContentProps) {
  return (
    <RP.Portal>
      <RP.Content
        side={side}
        align={align}
        sideOffset={6}
        collisionPadding={8}
        style={{ width }}
        className={cn('z-[70] max-w-[calc(100vw-16px)] rounded-[10px] border border-line bg-surface-2 p-3 text-sm text-fg', className)}
      >
        {children}
      </RP.Content>
    </RP.Portal>
  );
}
