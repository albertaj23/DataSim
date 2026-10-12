import { describe, expect, it } from 'vitest';
import { ValueGenerator } from '@datasim/shared';
import { PARAM_KINDS, SEED_KINDS, defaultGenerator, formatConstant, generatorError, parseConstant, parseList, parseOptionalNumber, parseWeights, sampleStrings } from './gen';

describe('generator factories', () => {
  it('every default generator parses with the shared zod schema and previews 5 values', () => {
    for (const kind of new Set([...SEED_KINDS, ...PARAM_KINDS])) {
      const g = defaultGenerator(kind);
      expect(ValueGenerator.safeParse(g).success, kind).toBe(true);
      expect(sampleStrings(g)).toHaveLength(5);
    }
  });
  it('previews are deterministic for a seed', () => {
    const g = defaultGenerator('uniformInt');
    expect(sampleStrings(g, 7)).toEqual(sampleStrings(g, 7));
  });
});

describe('text parsing', () => {
  it('parses lists and weights', () => {
    expect(parseList('a, b ,3,, 4.5')).toEqual(['a', 'b', 3, 4.5]);
    expect(parseWeights('1, 2')).toEqual([1, 2]);
    expect(parseWeights('1, x')).toBeUndefined();
    expect(parseWeights('')).toBeUndefined();
  });
  it('parses constants and optional numbers', () => {
    expect(parseConstant('null')).toBeNull();
    expect(parseConstant('true')).toBe(true);
    expect(parseConstant('12')).toBe(12);
    expect(parseConstant('abc')).toBe('abc');
    expect(formatConstant(null)).toBe('null');
    expect(parseOptionalNumber('')).toBeUndefined();
    expect(parseOptionalNumber('x')).toBeUndefined();
    expect(parseOptionalNumber('-3')).toBe(-3);
  });
});

describe('argument checks', () => {
  it('flags bad args', () => {
    expect(generatorError({ kind: 'uniformInt', min: 5, max: 1 })).toMatch(/min/);
    expect(generatorError({ kind: 'pickList', values: ['a'], weights: [1, 2] })).toMatch(/weights/);
    expect(generatorError({ kind: 'dateRange', from: 'nope', to: '2024-01-01' })).toBeTruthy();
    expect(generatorError({ kind: 'pattern', pattern: 'abc', mode: 'sequential' })).toBeTruthy();
    expect(generatorError(defaultGenerator('uniformInt'))).toBeNull();
  });
});
