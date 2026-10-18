export type ProblemSeverity = 'error' | 'warning';
export interface ProblemPath { nodeId?: string; edgeId?: string; table?: string; column?: string; txn?: string; variant?: string; step?: number; invariant?: string }
/** A validation finding with a path so the UI can jump to the offending node/table/step. */
export interface Problem { severity: ProblemSeverity; code: string; message: string; path: ProblemPath }
export const hasErrors = (p: Problem[]) => p.some((x) => x.severity === 'error');
