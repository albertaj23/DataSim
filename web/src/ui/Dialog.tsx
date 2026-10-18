import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { buttonClass } from './Button';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Right-aligned footer (buttons). */
  footer?: ReactNode;
  width?: number;
}

/** Centered modal. Esc and outside click close it. */
export function Dialog({ open, onOpenChange, title, description, children, footer, width = 440 }: DialogProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="ds-overlay fixed inset-0 z-[60] bg-[var(--scrim)]" />
        <RD.Content
          style={{ width }}
          className="ds-dialog fixed left-1/2 top-1/2 z-[61] max-h-[85vh] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[10px] border border-line bg-surface"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <RD.Title className="text-base font-medium text-fg">{title}</RD.Title>
              {description ? <RD.Description className="mt-0.5 text-xs text-muted">{description}</RD.Description> : <RD.Description className="sr-only">{title}</RD.Description>}
            </div>
            <RD.Close aria-label="Close" className={buttonClass('ghost', 'sm', undefined, true)}><X size={16} /></RD.Close>
          </div>
          <div className="max-h-[calc(85vh-110px)] overflow-auto px-4 py-3">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Left of the close button, e.g. toolbar actions. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Full-screen editor overlay (Schema Designer, Workload Editor). Esc closes. Content fills the body edge to edge. */
export function Overlay({ open, onClose, title, actions, children, className }: OverlayProps) {
  return (
    <RD.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <RD.Portal>
        <RD.Content className="ds-fade-in fixed inset-0 z-[60] flex flex-col bg-bg focus-visible:outline-none">
          <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
            <RD.Title className="text-base font-medium text-fg">{title}</RD.Title>
            <RD.Description className="sr-only">{title}</RD.Description>
            <div className="flex items-center gap-1.5">
              {actions}
              <span className="mr-1 hidden font-mono text-[11px] text-faint sm:inline">Esc</span>
              <RD.Close aria-label="Close" className={buttonClass('ghost', 'md', undefined, true)}><X size={16} /></RD.Close>
            </div>
          </header>
          <div className={cn('min-h-0 flex-1', className)}>{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
