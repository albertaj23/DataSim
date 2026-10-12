import { describe, expect, it } from 'vitest';
import { isSelectLike, starterQuery } from './queryLogic';

describe('queryLogic', () => {
  it('starts from the first table', () => {
    expect(starterQuery(['section', 'course'])).toBe('SELECT * FROM `section` LIMIT 20');
    expect(starterQuery([])).toBe('SELECT 1');
  });
  it('recognises read statements', () => {
    expect(isSelectLike('  select 1')).toBe(true);
    expect(isSelectLike('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(true);
    expect(isSelectLike('UPDATE t SET a = 1')).toBe(false);
    expect(isSelectLike('')).toBe(false);
  });
});
