import { describe, expect, it } from 'vitest';
import { Rng } from '../src/prng';
import { attributeClosure, candidateKeys, isLosslessJoin, minimalCover, normalize, parseFds, preservesDependencies } from '../src/normalize';
import type { FD } from '../src/normalize';

const fds = (t: string) => parseFds(t);
const sorted = (keys: string[][]) => keys.map((k) => k.join('')).sort();
const rel = (r: { attributes: string[] }) => r.attributes.join('');

describe('closure, keys, cover', () => {
  it('closure of AB under A->BC, E->CF, B->E, CD->EF', () => {
    expect(attributeClosure(['A', 'B', 'C', 'D', 'E', 'F'], fds('A->B,C\nE->C,F\nB->E\nC,D->E,F'), ['A', 'B']).join('')).toBe('ABCEF');
  });

  it('finds every candidate key (R(A..E), A->B, BC->E, ED->A: ACD, BCD, CDE)', () => {
    expect(sorted(candidateKeys(['A', 'B', 'C', 'D', 'E'], fds('A->B\nB,C->E\nE,D->A')))).toEqual(['ACD', 'BCD', 'CDE']);
  });

  it('minimal cover of A->BC, B->C, A->B, AB->C is A->B, B->C', () => {
    const mc = minimalCover(['A', 'B', 'C'], fds('A->B,C\nB->C\nA->B\nA,B->C'));
    expect(mc.map((f) => `${f.lhs.join('')}>${f.rhs.join('')}`).sort()).toEqual(['A>B', 'B>C']);
  });

  it('a relation with no FDs has the whole relation as its key', () => {
    expect(candidateKeys(['A', 'B', 'C'], [])).toEqual([['A', 'B', 'C']]);
  });
});

describe('normal forms', () => {
  it('A->B, B->C, C->D on R(A,B,C,D): key A, 2NF, BCNF decomposition AB, BC, CD', () => {
    const r = normalize(['A', 'B', 'C', 'D'], fds('A->B\nB->C\nC->D'));
    expect(sorted(r.candidateKeys)).toEqual(['A']);
    expect(r.highestNormalForm).toBe('2NF');
    expect(r.violations.map((v) => v.fd.lhs.join(''))).toEqual(['B', 'C']);
    expect(r.violations.every((v) => v.violates.includes('3NF') && v.violates.includes('BCNF'))).toBe(true);
    expect(r.bcnf.relations.map(rel).sort()).toEqual(['AB', 'BC', 'CD']);
    expect(r.bcnf.losslessJoin).toBe(true);
    expect(r.bcnf.preservesDependencies).toBe(true);
    expect(r.threeNf.relations.map(rel).sort()).toEqual(['AB', 'BC', 'CD']);
  });

  it('partial dependency (AB->C, B->D) is a 1NF relation', () => {
    const r = normalize(['A', 'B', 'C', 'D'], fds('A,B->C\nB->D'));
    expect(sorted(r.candidateKeys)).toEqual(['AB']);
    expect(r.highestNormalForm).toBe('1NF');
    expect(r.violations.find((v) => v.fd.lhs.join('') === 'B')!.violates).toContain('2NF');
    expect(r.threeNf.relations.map(rel).sort()).toEqual(['ABC', 'BD']);
    expect(r.threeNf.losslessJoin && r.threeNf.preservesDependencies).toBe(true);
  });

  it('AB->C, C->B is 3NF but not BCNF; BCNF is lossless but loses AB->C, 3NF keeps it', () => {
    const r = normalize(['A', 'B', 'C'], fds('A,B->C\nC->B'));
    expect(sorted(r.candidateKeys)).toEqual(['AB', 'AC']);
    expect(r.highestNormalForm).toBe('3NF');
    expect(r.nonPrimeAttributes).toEqual([]);
    expect(r.bcnf.relations.map(rel).sort()).toEqual(['AC', 'BC']);
    expect(r.bcnf.losslessJoin).toBe(true);
    expect(r.bcnf.preservesDependencies).toBe(false);
    expect(r.threeNf.relations.map(rel)).toEqual(['ABC']);
    expect(r.threeNf.preservesDependencies).toBe(true);
  });

  it('a relation whose only FD has a key on the left is in BCNF', () => {
    const r = normalize(['id', 'name', 'email'], fds('id->name,email'));
    expect(r.highestNormalForm).toBe('BCNF');
    expect(r.violations).toEqual([]);
    expect(r.bcnf.steps[0]).toMatch(/Already in BCNF/);
  });

  it('3NF synthesis adds a key relation when none of the cover relations contains one', () => {
    const r = normalize(['A', 'B', 'C'], fds('A->B'));
    expect(sorted(r.candidateKeys)).toEqual(['AC']);
    expect(r.threeNf.relations.map(rel).sort()).toEqual(['AB', 'AC']);
    expect(r.threeNf.losslessJoin).toBe(true);
  });

  it('student/course example: S,C -> G; S -> D; D -> H splits into (S,C,G), (S,D), (D,H)', () => {
    const r = normalize(['S', 'C', 'G', 'D', 'H'], fds('S,C->G\nS->D\nD->H'));
    expect(sorted(r.candidateKeys)).toEqual(['SC']);
    expect(r.highestNormalForm).toBe('1NF');
    expect(r.threeNf.relations.map((x) => [...x.attributes].sort().join('')).sort()).toEqual(['CGS', 'DH', 'DS']);
    expect(r.bcnf.losslessJoin).toBe(true);
  });

  it('returns a requested closure and rejects bad input', () => {
    expect(normalize(['A', 'B', 'C'], fds('A->B\nB->C'), ['A']).closure).toEqual(['A', 'B', 'C']);
    expect(() => normalize(['A'], fds('A->Z'))).toThrow(/unknown attribute Z/);
    expect(() => parseFds('A B')).toThrow(/Cannot parse/);
  });
});

describe('lossless join and dependency preservation', () => {
  it('chase: (A,B),(A,C) is lossless under A->B, but (A,B),(B,C) is not', () => {
    const f = fds('A->B');
    expect(isLosslessJoin(['A', 'B', 'C'], f, [['A', 'B'], ['A', 'C']])).toBe(true);
    expect(isLosslessJoin(['A', 'B', 'C'], f, [['A', 'B'], ['B', 'C']])).toBe(false);
  });
  it('dependency preservation test', () => {
    expect(preservesDependencies(['A', 'B', 'C'], fds('A,B->C\nC->B'), [['A', 'C'], ['B', 'C']])).toBe(false);
    expect(preservesDependencies(['A', 'B', 'C'], fds('A->B\nB->C'), [['A', 'B'], ['B', 'C']])).toBe(true);
  });
});

describe('properties on random FD sets', () => {
  it('keys are minimal superkeys; decompositions are lossless; 3NF preserves dependencies; fragments reach the target NF', () => {
    const rng = new Rng(2026);
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (let iter = 0; iter < 60; iter++) {
      const n = rng.int(3, 6); const attrs = names.slice(0, n);
      const f: FD[] = Array.from({ length: rng.int(1, 5) }, () => {
        const lhs = attrs.filter(() => rng.float() < 0.35); const rhs = attrs.filter(() => rng.float() < 0.3);
        return { lhs: lhs.length ? lhs : [attrs[rng.int(0, n - 1)]!], rhs: rhs.length ? rhs : [attrs[rng.int(0, n - 1)]!] };
      });
      const r = normalize(attrs, f);
      for (const k of r.candidateKeys) {
        expect(attributeClosure(attrs, f, k).length).toBe(n);
        for (const a of k) expect(attributeClosure(attrs, f, k.filter((x) => x !== a)).length).toBeLessThan(n);
      }
      expect(r.bcnf.losslessJoin).toBe(true);
      expect(r.threeNf.losslessJoin).toBe(true);
      expect(r.threeNf.preservesDependencies).toBe(true);
      // every fragment, analysed on its own projected FDs, is in the target normal form
      for (const fr of r.bcnf.relations) expect(normalize(fr.attributes, fr.fds).highestNormalForm).toBe('BCNF');
      for (const fr of r.threeNf.relations) expect(['3NF', 'BCNF']).toContain(normalize(fr.attributes, fr.fds).highestNormalForm);
      // the minimal cover is equivalent to F
      const mc = minimalCover(attrs, f);
      for (const d of f) expect(attributeClosure(attrs, mc, d.lhs)).toEqual(expect.arrayContaining(d.rhs));
      for (const d of mc) expect(attributeClosure(attrs, f, d.lhs)).toEqual(expect.arrayContaining(d.rhs));
    }
  });
});
