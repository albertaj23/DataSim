import type { ReactNode } from 'react';
import { Skeleton, cn } from '../ui';

/** Standard page body: 24px padding, max width 1280. (Studio does not use this: it is full-bleed.) */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1280px] p-6', className)}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-medium text-fg">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Suspense fallback for lazy routes. */
export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1280px] p-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-6 w-48" />
      <Skeleton className="mb-6 h-4 w-80" />
      <Skeleton className="mb-2 h-9 w-full" />
      <Skeleton className="mb-2 h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}
