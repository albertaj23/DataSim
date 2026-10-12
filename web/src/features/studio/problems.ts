import type { DesignDoc, Problem } from '@datasim/shared';

const key = (p: Problem) => `${p.severity}|${p.code}|${p.message}`;

/** Client-side problems first, then server-only ones (the server repeats the static checks). Errors sort before warnings. */
export function mergeProblems(client: Problem[], server: Problem[]): Problem[] {
  const seen = new Set(client.map(key));
  const all = [...client, ...server.filter((p) => !seen.has(key(p)))];
  return all.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

/** nodeId -> worst severity; edge problems are charged to both endpoints. */
export function healthByNode(problems: Problem[], design: Pick<DesignDoc, 'edges'>): Map<string, 'error' | 'warning'> {
  const out = new Map<string, 'error' | 'warning'>();
  const mark = (id: string | undefined, sev: 'error' | 'warning') => {
    if (!id) return;
    if (out.get(id) !== 'error') out.set(id, sev);
  };
  for (const p of problems) {
    mark(p.path.nodeId, p.severity);
    if (p.path.edgeId) {
      const e = design.edges.find((x) => x.id === p.path.edgeId);
      mark(e?.source, p.severity); mark(e?.target, p.severity);
    }
  }
  return out;
}

export type ProblemTarget =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'table'; table: string }
  | { kind: 'workload' }
  | { kind: 'none' };

/** Where clicking a problem should take the user. */
export function problemTarget(p: Problem): ProblemTarget {
  const x = p.path;
  if (x.nodeId) return { kind: 'node', id: x.nodeId };
  if (x.edgeId) return { kind: 'edge', id: x.edgeId };
  if (x.table) return { kind: 'table', table: x.table };
  if (x.txn || x.invariant) return { kind: 'workload' };
  return { kind: 'none' };
}

/** Short location label for the problem list: "App server", "section.slot", "register step 2". */
export function problemWhere(p: Problem, design: Pick<DesignDoc, 'nodes' | 'edges'>): string {
  const x = p.path;
  if (x.nodeId) return design.nodes.find((n) => n.id === x.nodeId)?.name ?? x.nodeId;
  if (x.edgeId) {
    const e = design.edges.find((q) => q.id === x.edgeId);
    const name = (id?: string) => design.nodes.find((n) => n.id === id)?.name ?? id ?? '?';
    return e ? `${name(e.source)} to ${name(e.target)}` : 'link';
  }
  if (x.table) return x.column ? `${x.table}.${x.column}` : x.table;
  if (x.txn) return x.step != null ? `${x.txn} step ${x.step + 1}` : x.txn;
  if (x.invariant) return x.invariant;
  return 'design';
}
