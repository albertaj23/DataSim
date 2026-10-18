import { describe, expect, it } from 'vitest';
import { normalize, parseFds } from '@datasim/shared';
import { checkAttributes, defaultFds, EXAMPLES, fdText, lostDependencies, parseAttrList, parseFdsFor } from './normalizeView';

describe('normalizeView', () => {
  it('every example parses and analyses', () => {
    for (const ex of EXAMPLES) {
      const p = parseFdsFor(ex.fds, ex.attributes);
      expect(p.ok, ex.id).toBe(true);
      if (p.ok) expect(() => normalize(ex.attributes, p.fds)).not.toThrow();
    }
  });

  it('examples reach the normal forms they teach', () => {
    const nf = (id: string) => { const e = EXAMPLES.find((x) => x.id === id)!; return normalize(e.attributes, parseFds(e.fds)).highestNormalForm; };
    expect(nf('chain')).toBe('1NF');
    expect(nf('sci')).toBe('3NF');
    expect(nf('bcnf')).toBe('BCNF');
  });

  it('flags unknown attributes and malformed lines', () => {
    expect(parseFdsFor('A -> Z', ['A', 'B'])).toEqual({ ok: false, error: '"Z" in A → Z is not an attribute of the relation' });
    expect(parseFdsFor('A B', ['A', 'B']).ok).toBe(false);
    expect(parseAttrList('a, b  c,a')).toEqual(['a', 'b', 'c']);
    expect(checkAttributes([])).toMatch(/at least one/i);
    expect(checkAttributes(Array.from({ length: 17 }, (_, i) => `c${i}`))).toMatch(/at most 16/i);
    expect(fdText({ lhs: ['A', 'B'], rhs: ['C'] })).toBe('A, B → C');
  });

  it('defaultFds turns keys into FDs', () => {
    const t = { columns: ['id', 'email', 'name'].map((name) => ({ name })) as never, primaryKey: ['id'], uniques: [{ columns: ['email'] }] };
    expect(defaultFds(t)).toBe('id -> email, name\nemail -> id, name');
  });

  it('lostDependencies: student/course/instructor loses student,course -> instructor under BCNF, nothing under 3NF', () => {
    const e = EXAMPLES.find((x) => x.id === 'sci')!;
    const fds = parseFds(e.fds);
    const r = normalize(e.attributes, fds);
    const lostB = lostDependencies(e.attributes, fds, r.bcnf.relations.map((x) => x.attributes));
    expect(lostB.map(fdText)).toEqual(['student, course → instructor']);
    expect(r.bcnf.preservesDependencies).toBe(false);
    expect(lostDependencies(e.attributes, fds, r.threeNf.relations.map((x) => x.attributes))).toEqual([]);
    expect(r.threeNf.preservesDependencies).toBe(true);
  });
});

describe('closureTrace', () => {
  it('records each FD application and matches attributeClosure', async () => {
    const { closureTrace } = await import('./normalizeView');
    const { attributeClosure } = await import('@datasim/shared');
    const attrs = ['A', 'B', 'C', 'D'];
    const fds = parseFds('A -> B\nB -> C');
    const t = closureTrace(attrs, fds, ['A']);
    expect(t.steps.map((s) => s.added)).toEqual([['B'], ['C']]);
    expect(t.result).toEqual(attributeClosure(attrs, fds, ['A']));
    expect(closureTrace(attrs, fds, ['D']).steps).toEqual([]);
  });
});
