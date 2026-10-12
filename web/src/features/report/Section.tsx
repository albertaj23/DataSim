import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Provenance } from '@datasim/shared';
import { ProvenanceTag, buttonClass, cn } from '../../ui';

/** Titled block of the report: heading row (title, provenance, right-aligned aside) over a body. */
export function Section({ id, title, provenance, aside, children, className }: {
  id?: string; title: string; provenance?: Provenance; aside?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className={cn('scroll-mt-4', className)}>
      <header className="mb-2 flex min-h-6 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={id ? `${id}-h` : undefined} className="truncate text-base font-medium text-fg">{title}</h2>
          {provenance && <ProvenanceTag kind={provenance} />}
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2 text-xs text-muted">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

/** Bordered surface for a block of related content. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-line bg-surface', className)}>{children}</div>;
}

/** Right-hand sheet (Radix dialog under the hood: focus trap, Esc, outside click). */
export function Drawer({ open, onOpenChange, title, description, children, width = 560 }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; children: ReactNode; width?: number;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="ds-overlay fixed inset-0 z-[60] bg-[var(--scrim)]" />
        <RD.Content
          style={{ width }}
          className="ds-fade-in fixed inset-y-0 right-0 z-[61] flex max-w-[calc(100vw-48px)] flex-col border-l border-line bg-surface focus-visible:outline-none"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <RD.Title className="text-base font-medium text-fg">{title}</RD.Title>
              {description ? <RD.Description className="mt-0.5 text-xs text-muted">{description}</RD.Description> : <RD.Description className="sr-only">{title}</RD.Description>}
            </div>
            <RD.Close aria-label="Close" className={buttonClass('ghost', 'sm', undefined, true)}><X size={16} /></RD.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
