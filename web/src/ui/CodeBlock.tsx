import { lazy, Suspense } from 'react';
import { Skeleton } from './Misc';
import type { CodeBlockProps } from './CodeBlockEditor';

export type { CodeBlockProps };

// CodeMirror is heavy: load it on first use so it stays out of the main bundle.
const Editor = lazy(() => import('./CodeBlockEditor'));

/** Read-only SQL block with copy and optional download. (For SQL/editor extensions import from './codemirror'.) */
export function CodeBlock(props: CodeBlockProps) {
  return (
    <Suspense fallback={<Skeleton className="h-24 w-full rounded-lg" />}>
      <Editor {...props} />
    </Suspense>
  );
}
