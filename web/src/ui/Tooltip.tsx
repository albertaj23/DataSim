import * as RT from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <RT.Provider delayDuration={300} skipDelayDuration={150}>{children}</RT.Provider>
);

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Optional keyboard hint shown after the text, e.g. "Ctrl+Enter". */
  shortcut?: string;
  disabled?: boolean;
}

/** Wraps a single focusable child (asChild). */
export function Tooltip({ content, children, side = 'top', align = 'center', shortcut, disabled }: TooltipProps) {
  if (disabled || content == null || content === '') return <>{children}</>;
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="z-[80] max-w-[280px] rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-fg"
        >
          {content}
          {shortcut && <span className="ml-2 font-mono text-[11px] text-faint">{shortcut}</span>}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
