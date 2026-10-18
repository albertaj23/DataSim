import { lazy, Suspense } from 'react';
import { Skeleton } from '../../ui';
import type { SqlEditorProps } from './SqlEditor';

// CodeMirror is heavy: load the editor on first use.
const Impl = lazy(() => import('./SqlEditor').then((m) => ({ default: m.SqlEditor })));

export function LazySqlEditor(props: SqlEditorProps) {
  return (
    <Suspense fallback={<Skeleton className="w-full rounded-lg" style={{ height: props.minHeight ?? 72 }} />}>
      <Impl {...props} />
    </Suspense>
  );
}
