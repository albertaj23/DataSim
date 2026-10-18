// Pure helpers behind the normalization dialog: examples, FD formatting/validation, per-FD dependency preservation.
import { attributeClosure, MAX_ATTRS, parseFds, type FD, type Table } from '@datasim/shared';

export const fdText = (f: FD) => `${f.lhs.join(', ')} → ${f.rhs.join(', ')}`;
export const relationText = (name: string, attrs: string[]) => `${name}(${attrs.join(', ')})`;

export interface NormalizeExample { id: string; label: string; attributes: string[]; fds: string; note: string }
export const EXAMPLES: NormalizeExample[] = [
  { id: 'chain', label: 'R(A,B,C,D): A → B, B → C', attributes: ['A', 'B', 'C', 'D'], fds: 'A -> B\nB -> C', note: 'The only key is AD, so A → B is a partial dependency (2NF fails) and B → C is transitive.' },
  { id: 'sci', label: 'Student, course, instructor (3NF, not BCNF)', attributes: ['student', 'course', 'instructor'], fds: 'student, course -> instructor\ninstructor -> course', note: 'Both {student, course} and {student, instructor} are keys. instructor → course has a prime right side, so 3NF holds but BCNF fails, and BCNF cannot keep student, course → instructor.' },
  { id: 'enrol', label: 'Enrollment with department (transitive)', attributes: ['student_id', 'course_id', 'grade', 'dept', 'dept_head'], fds: 'student_id, course_id -> grade\nstudent_id -> dept\ndept -> dept_head', note: 'student_id → dept is partial, dept → dept_head is transitive. Both decompositions give grades, student-department and department tables.' },
  { id: 'orders', label: 'Order lines (partial dependencies)', attributes: ['order_id', 'product_id', 'qty', 'product_name', 'unit_price', 'customer_id', 'order_date'], fds: 'order_id, product_id -> qty\nproduct_id -> product_name, unit_price\norder_id -> customer_id, order_date', note: 'Classic 2NF repair: split order header, product and order line.' },
  { id: 'bcnf', label: 'Already in BCNF: R(A,B,C), A → B, C', attributes: ['A', 'B', 'C'], fds: 'A -> B, C', note: 'The determinant is a key, so there is nothing to decompose.' },
];

/** Starting FDs for a table: every key (PK and UNIQUE) determines the remaining columns. */
export function defaultFds(t: Pick<Table, 'columns' | 'primaryKey' | 'uniques'>): string {
  const all = t.columns.map((c) => c.name);
  const keys = [t.primaryKey, ...t.uniques.map((u) => u.columns)];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const k of keys) {
    const id = k.join(',');
    const rest = all.filter((c) => !k.includes(c));
    if (seen.has(id) || rest.length === 0) continue;
    seen.add(id);
    lines.push(`${k.join(', ')} -> ${rest.join(', ')}`);
  }
  return lines.join('\n');
}

/** Splits "A, B  C" into unique attribute names. */
export const parseAttrList = (text: string): string[] => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];

export type FdParse = { ok: true; fds: FD[] } | { ok: false; error: string };
/** Parses FD text and checks every attribute belongs to the relation. */
export function parseFdsFor(text: string, attributes: string[]): FdParse {
  let fds: FD[];
  try { fds = parseFds(text); } catch (e) { return { ok: false, error: (e as Error).message }; }
  for (const f of fds) {
    const bad = [...f.lhs, ...f.rhs].find((a) => !attributes.includes(a));
    if (bad !== undefined) return { ok: false, error: `"${bad}" in ${fdText(f)} is not an attribute of the relation` };
  }
  return { ok: true, fds };
}

export function checkAttributes(attrs: string[]): string | null {
  if (attrs.length === 0) return 'Enter at least one attribute';
  if (attrs.length > MAX_ATTRS) return `At most ${MAX_ATTRS} attributes are supported (${attrs.length} given)`;
  return null;
}

/**
 * The given FDs that cannot be enforced inside the fragments. Exact test: grow the left side by closing
 * its overlap with every fragment under all FDs, repeat until stable, then check the right side is reached.
 */
export function lostDependencies(attributes: string[], fds: FD[], fragments: string[][]): FD[] {
  return fds.filter((d) => {
    let z = new Set(d.lhs);
    for (let changed = true; changed;) {
      changed = false;
      for (const r of fragments) {
        const inter = [...z].filter((a) => r.includes(a));
        for (const a of attributeClosure(attributes, fds, inter)) if (r.includes(a) && !z.has(a)) { z.add(a); changed = true; }
      }
    }
    return !d.rhs.every((a) => z.has(a));
  });
}

export interface ClosureTrace { start: string[]; steps: Array<{ fd: FD; added: string[] }>; result: string[] }
/** Textbook closure computation, one FD application per step (only steps that add something are recorded). */
export function closureTrace(attributes: string[], fds: FD[], start: string[]): ClosureTrace {
  const have = new Set(start);
  const steps: ClosureTrace['steps'] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const fd of fds) {
      if (!fd.lhs.every((a) => have.has(a))) continue;
      const added = fd.rhs.filter((a) => !have.has(a));
      if (added.length) { added.forEach((a) => have.add(a)); steps.push({ fd, added }); changed = true; }
    }
  }
  return { start, steps, result: attributes.filter((a) => have.has(a)) };
}
