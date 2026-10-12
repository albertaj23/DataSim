import * as RTabs from '@radix-ui/react-tabs';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from './cn';

/** Controlled or uncontrolled underline tabs. Compose: <Tabs value onValueChange><TabsList><TabsTrigger value>..</TabsTrigger></TabsList><TabsContent value>..</TabsContent></Tabs> */
export const Tabs = RTabs.Root;

export function TabsList({ className, ...rest }: ComponentPropsWithoutRef<typeof RTabs.List>) {
  return <RTabs.List className={cn('flex items-center gap-0.5 border-b border-line', className)} {...rest} />;
}

export function TabsTrigger({ className, children, count, ...rest }: ComponentPropsWithoutRef<typeof RTabs.Trigger> & { count?: ReactNode }) {
  return (
    <RTabs.Trigger
      className={cn(
        '-mb-px inline-flex h-8 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-sm text-muted transition-colors duration-150 ease-out hover:text-fg focus-visible:bg-surface-3 focus-visible:text-fg focus-visible:outline-none data-[state=active]:border-accent data-[state=active]:text-fg',
        className,
      )}
      {...rest}
    >
      {children}
      {count != null && <span className="rounded bg-surface-3 px-1 font-mono text-[11px] text-muted tnum">{count}</span>}
    </RTabs.Trigger>
  );
}

export function TabsContent({ className, ...rest }: ComponentPropsWithoutRef<typeof RTabs.Content>) {
  return <RTabs.Content className={cn('focus-visible:outline-none', className)} {...rest} />;
}
