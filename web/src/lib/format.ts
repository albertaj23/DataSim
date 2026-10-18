// Number and time formatting. All pure; locale is pinned so output is stable in tests and demos.

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Thousands separators; `digits` fixes the decimals (default: integer). */
export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '-';
  if (digits === 0) return nf0.format(n);
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Milliseconds: 0.42 ms, 41 ms, 1.24 s, 2m 05s. */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '-';
  const a = Math.abs(ms);
  if (a < 1) return `${ms.toFixed(2)} ms`;
  if (a < 100) return `${Number(ms.toFixed(1))} ms`;
  if (a < 1000) return `${Math.round(ms)} ms`;
  if (a < 60_000) return `${Number((ms / 1000).toFixed(2))} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** `ratio` is 0..1 by default; pass `isPercent` when the value is already 0..100. */
export function formatPct(v: number | null | undefined, digits = 1, isPercent = false): string {
  if (v == null || !Number.isFinite(v)) return '-';
  return `${(isPercent ? v : v * 100).toFixed(digits)}%`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.abs(bytes);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const out = i === 0 ? String(Math.round(v)) : v >= 100 ? v.toFixed(0) : v.toFixed(1);
  return `${bytes < 0 ? '-' : ''}${out} ${units[i]}`;
}

/** "just now", "3 min ago", "2 h ago", "5 d ago", then a date. `now` is injectable for tests. */
export function relativeTime(input: string | number | Date | null | undefined, now: number = Date.now()): string {
  if (input == null) return '-';
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(t)) return '-';
  const s = Math.round((now - t) / 1000);
  if (s < 0) return 'just now';
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** First 8 characters of an id (uuid or hash). */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '-';
}
