import { describe, expect, it } from 'vitest';
import { formatBytes, formatMs, formatNumber, formatPct, relativeTime, shortId } from './format';

describe('format', () => {
  it('formatNumber groups thousands', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(1234.5678, 2)).toBe('1,234.57');
    expect(formatNumber(null)).toBe('-');
    expect(formatNumber(NaN)).toBe('-');
  });

  it('formatMs picks a sensible unit', () => {
    expect(formatMs(0.42)).toBe('0.42 ms');
    expect(formatMs(41.26)).toBe('41.3 ms');
    expect(formatMs(250)).toBe('250 ms');
    expect(formatMs(1240)).toBe('1.24 s');
    expect(formatMs(125_000)).toBe('2m 05s');
  });

  it('formatPct and formatBytes', () => {
    expect(formatPct(0.873)).toBe('87.3%');
    expect(formatPct(87.3, 1, true)).toBe('87.3%');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('relativeTime and shortId', () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    expect(relativeTime('2026-10-12T11:59:58Z', now)).toBe('just now');
    expect(relativeTime('2026-10-12T11:57:00Z', now)).toBe('3 min ago');
    expect(relativeTime('2026-10-12T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-10-07T12:00:00Z', now)).toBe('5 d ago');
    expect(shortId('a1b2c3d4-e5f6-7890')).toBe('a1b2c3d4');
  });
});
