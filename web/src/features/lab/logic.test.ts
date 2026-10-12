import { describe, expect, it } from 'vitest';
import type { ExperimentRun } from '../../lib/labApi';
import {
  aggregateRuns, aggregatesToCsv, aggregatesToMarkdown, csvCell, fmtMean, labErrorMessage, meanTitle, median, planStrategies, reviewName,
  trialsToCsv, validateStreamParams,
} from './logic';

function run(over: Partial<ExperimentRun>): ExperimentRun {
  return {
    runId: 1, experiment: 'STREAM_LIMIT', strategy: 'NAIVE', isolationLevel: 'AUTOCOMMIT', mode: 'NORMAL', concurrency: 30, accounts: 1, maxStreams: 1,
    raceDelayMs: 20, granted: 5, rejected: 25, retries: 0, deadlocks: 0, lockTimeouts: 0, errors: 0, violations: 0, p50Ms: 10, p95Ms: 20,
    throughputRps: 100, wallMs: 300, batchId: 'b1', trial: 1, source: 'UI', detail: null, createdAt: '2026-10-12T10:00:00.000Z', ...over,
  };
}

describe('lab logic', () => {
  it('median handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('aggregateRuns groups by batch+strategy like the server aggregate', () => {
    const rows = [
      run({ runId: 1, trial: 1, violations: 4, p95Ms: 30, retries: 2 }),
      run({ runId: 2, trial: 2, violations: 0, p95Ms: 10, retries: 0 }),
      run({ runId: 3, trial: 3, violations: 2, p95Ms: 20, retries: 1 }),
      run({ runId: 4, strategy: 'ATOMIC', experiment: 'LOST_UPDATE', batchId: 'b2', createdAt: '2026-10-12T11:00:00.000Z' }),
    ];
    const aggs = aggregateRuns(rows);
    expect(aggs).toHaveLength(2);
    expect(aggs[0]!.name).toBe('ATOMIC'); // newest first
    const naive = aggs.find((a) => a.name === 'NAIVE')!;
    expect(naive.trials).toBe(3);
    expect(naive.violations).toBe(6);
    expect(naive.violatingPct).toBe(67);
    expect(naive.p95).toBe(20); // median of 30, 10, 20
    expect(naive.retries).toBe(1); // mean of 2, 0, 1
  });

  it('runs without a batch id stay separate', () => {
    const aggs = aggregateRuns([run({ runId: 1, batchId: null }), run({ runId: 2, batchId: null })]);
    expect(aggs).toHaveLength(2);
  });

  it('csvCell quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('x\ny')).toBe('"x\ny"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12)).toBe('12');
  });

  it('trialsToCsv has a header and one line per trial', () => {
    const csv = trialsToCsv([run({ runId: 7 }), run({ runId: 8 })]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]!.startsWith('run_id,created_at,experiment,strategy')).toBe(true);
    expect(lines[1]!.startsWith('7,')).toBe(true);
    expect(lines[1]!.split(',')).toHaveLength(lines[0]!.split(',').length);
  });

  it('aggregatesToCsv and Markdown render the same rows', () => {
    const aggs = aggregateRuns([run({ violations: 3 })]);
    expect(aggregatesToCsv(aggs).trim().split('\n')).toHaveLength(2);
    const md = aggregatesToMarkdown(aggs, 'T', new Date('2026-10-12T00:00:00Z'));
    expect(md).toContain('# T');
    expect(md).toContain('| NAIVE | AUTOCOMMIT | 1 |');
    expect(md).toContain('playback_session = allocation');
    expect(aggregatesToMarkdown([])).toContain('No runs.');
  });

  it('maps legacy table names to Review 1 vocabulary', () => {
    expect(reviewName('playback_session')).toBe('allocations');
    expect(reviewName('device')).toBe('clients');
    expect(reviewName('mystery')).toBe('mystery');
  });

  it('planStrategies skips CONSTRAINT above 1 stream and REDIS_LEASE without Redis', () => {
    const p = planStrategies(['NAIVE', 'CONSTRAINT', 'REDIS_LEASE'], 2, false);
    expect(p.run).toEqual(['NAIVE']);
    expect(p.skipped.map((s) => s.name)).toEqual(['CONSTRAINT', 'REDIS_LEASE']);
    expect(planStrategies(['CONSTRAINT', 'REDIS_LEASE'], 1, true).run).toEqual(['CONSTRAINT', 'REDIS_LEASE']);
  });

  it('validateStreamParams mirrors the server limits', () => {
    expect(validateStreamParams({ strategies: [], concurrency: 10, accounts: 1, maxStreams: 1 })).toMatch(/at least one/);
    expect(validateStreamParams({ strategies: ['NAIVE'], concurrency: 100, accounts: 1, maxStreams: 1 })).toMatch(/raise accounts to 2/);
    expect(validateStreamParams({ strategies: ['NAIVE'], concurrency: 30, accounts: 1, maxStreams: 1 })).toBeNull();
  });

  it('labErrorMessage gives dependency-specific wording', () => {
    expect(labErrorMessage({ status: 409 })).toMatch(/Another experiment/);
    expect(labErrorMessage({ status: 500, message: 'ECONNREFUSED' }, 'REDIS_LEASE')).toMatch(/Redis is unavailable/);
    expect(labErrorMessage({ status: 500, message: 'boom' }, 'TRIGGER')).toMatch(/CREATE TRIGGER/);
    expect(labErrorMessage({ status: 400, message: 'bad' }, 'REDIS_LEASE')).toBe('bad');
    expect(labErrorMessage({ status: 0 })).toMatch(/offline/);
  });

  it('fmtMean keeps at most one decimal and drops trailing zeros', () => {
    expect(fmtMean(70.2)).toBe('70.2');
    expect(fmtMean(0.9)).toBe('0.9');
    expect(fmtMean(12)).toBe('12');
    expect(fmtMean(3.04)).toBe('3');
    expect(fmtMean(1234.56)).toBe('1,234.6');
    expect(meanTitle(70.2, 10)).toBe('702 in total over 10 trials');
    expect(meanTitle(1, 1)).toBe('1 in total over 1 trial');
  });

  it('uses quota wording, not stream wording, in exports', () => {
    const csv = aggregatesToCsv(aggregateRuns([run({})]));
    expect(csv).toContain('quota_max_active');
    expect(aggregatesToMarkdown(aggregateRuns([run({})]))).toContain('Quota (max active)');
    expect(aggregatesToMarkdown(aggregateRuns([run({})]))).not.toMatch(/stream/i);
  });
});
