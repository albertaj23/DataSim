// Markdown and CSV exports of a run report.
import type { RunReport } from '@datasim/shared';

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '-');
const pct = (v: number | null) => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);
const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const table = (head: string[], rows: unknown[][]) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

export function reportToMarkdown(r: RunReport): string {
  const run = r.run;
  const out: string[] = [];
  out.push(`# DataSim run report: ${run.projectName ?? run.projectId}`);
  out.push('');
  out.push(`- Run: \`${run.runId}\` (${run.kind}, ${run.status})`);
  out.push(`- Revision: ${run.revisionNo} | Strategy: ${run.strategy} | Isolation: ${run.isolation} | VUs: ${run.vus} | Duration: ${run.durationS} s | Seed: ${run.seed}`);
  out.push(`- MySQL: ${run.mysqlVersion ?? '-'} | Started: ${run.startedAt ?? '-'} | Finished: ${run.finishedAt ?? '-'}`);
  if (r.slo) out.push(`- SLO verdict: **${r.slo.pass ? 'PASS' : 'FAIL'}**${r.slo.reasons.length ? ` (${r.slo.reasons.join('; ')})` : ''}`);
  if (run.errorText) out.push(`- Error: ${run.errorText}`);
  if (r.bottleneck) out.push(`- Bottleneck (${r.bottleneck.severity}): ${r.bottleneck.reason}`);
  out.push('', 'Provenance: latency, TPS, lock waits, invariants, digests and cache hit ratio are MEASURED; link latency and app processing time are EMULATED (real awaits in the request path); capacity projections are PROJECTED (USL fit).', '');

  out.push('## Summary (MEASURED)', '', table(['TPS', 'p50 ms', 'p95 ms', 'p99 ms', 'Transactions', 'Committed', 'Rejected', 'Errors', 'Retries', 'Deadlocks', 'Lock timeouts', 'Invariant violations'],
    [[f(run.tpsAvg), f(run.p50Ms), f(run.p95Ms), f(run.p99Ms), run.txnTotal, run.committed, run.rejected, run.errored, run.retries, run.deadlocks, run.lockTimeouts, run.invariantViolations]]), '');
  if (r.cacheHitRatio !== null) out.push(`Cache hit ratio: ${pct(r.cacheHitRatio)}`, '');

  if (r.capacity) {
    out.push('## Capacity test', '', r.capacity.sentence, '');
    out.push(table(['Step', 'VUs', 'TPS', 'p50 ms', 'p95 ms', 'Error rate'], r.capacity.points.map((p) => [p.stepNo, p.vus, f(p.tps), f(p.p50Ms), f(p.p95Ms), pct(p.errorRate)])), '');
    if (r.capacity.fit) {
      const x = r.capacity.fit;
      out.push(`USL fit (PROJECTED): lambda ${f(x.lambda, 2)}, sigma ${x.sigma.toExponential(3)}, kappa ${x.kappa.toExponential(3)}, N* ${x.nPeak === null ? 'none (no saturation observed)' : f(x.nPeak, 0)}, Xmax ${x.xMax === null ? 'none' : `${f(x.xMax, 0)} tps`}, R2 ${x.r2.toFixed(3)}. Knee: ${r.capacity.kneeVus ?? 'none'}; sustained: ${r.capacity.sustainedVus ?? 'none'} VUs.`, '');
    }
  }

  out.push('## Transactions', '', table(['Transaction', 'Count', 'Committed', 'Rejected', 'Errors', 'Retries', 'Deadlocks', 'p50', 'p95', 'p99', 'Queue ms', 'Network ms', 'App ms', 'Pool ms', 'DB ms'],
    r.txnStats.map((t) => [t.txnName, t.count, t.committed, t.rejected, t.errored, t.retries, t.deadlocks, f(t.p50Ms), f(t.p95Ms), f(t.p99Ms), f(t.queueMs, 2), f(t.netMs, 2), f(t.appMs, 2), f(t.poolMs, 2), f(t.dbMs, 2)])), '');
  out.push('Where the time went: queue, pool wait and DB execution are MEASURED; network and app processing are EMULATED.', '');

  out.push('## Invariants', '');
  out.push(r.invariants.length ? table(['Invariant', 'Violations', 'Result', 'Description'], r.invariants.map((i) => [i.name, i.violations, i.error ? `ERROR: ${i.error}` : i.passed ? 'PASS' : 'FAIL', i.description ?? ''])) : 'No invariants defined.', '');

  out.push('## Findings', '');
  if (r.findings.length === 0) out.push('No findings.', '');
  for (const x of r.findings) {
    out.push(`### [${x.severity}] ${x.title}`, '', x.explanation, '', `Evidence: \`${JSON.stringify(x.evidence)}\``);
    if (x.fix) out.push('', `Suggested fix: ${x.fixLabel ?? x.fix.type} (\`${JSON.stringify(x.fix)}\`)`);
    out.push('');
  }

  out.push('## Statements (MEASURED, performance_schema)', '', table(['Statement', 'Transaction', 'Executions', 'Avg ms', 'Max ms', 'Rows examined', 'No index', 'Lock ms'],
    r.statementStats.slice(0, 15).map((s) => [`\`${s.digestText.slice(0, 90)}\``, s.txnName ?? '', s.execCount, f(s.avgMs, 3), f(s.maxMs, 2), s.rowsExamined, s.noIndexUsed, f(s.lockTimeMs, 2)])), '');

  if (r.lockWaits.length) {
    out.push('## Lock waits (sampled)', '', table(['At ms', 'Waiting', 'Blocking', 'Table', 'Index', 'Mode', 'Key'], r.lockWaits.slice(0, 25).map((l) => [l.atMs, l.waitingTxn, l.blockingTxn, l.tableName, l.indexName ?? '', l.lockMode, l.lockData ?? ''])), '');
  }
  return out.join('\n');
}

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (head: string[], rows: unknown[][]) => [head.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n';

/** `samples` (default): one row per second. `txn`: per-transaction statistics. */
export function reportToCsv(r: RunReport, part: 'samples' | 'txn' = 'samples'): string {
  if (part === 'txn') {
    return csv(['txn_name', 'count', 'committed', 'rejected', 'errored', 'retries', 'deadlocks', 'p50_ms', 'p95_ms', 'p99_ms', 'mean_ms', 'queue_ms', 'net_ms', 'app_ms', 'pool_ms', 'db_ms'],
      r.txnStats.map((t) => [t.txnName, t.count, t.committed, t.rejected, t.errored, t.retries, t.deadlocks, t.p50Ms, t.p95Ms, t.p99Ms, t.meanMs, t.queueMs, t.netMs, t.appMs, t.poolMs, t.dbMs]));
  }
  return csv(['t_s', 'tps', 'p50_ms', 'p95_ms', 'p99_ms', 'errors', 'active_vus', 'app_queue', 'pool_waiting', 'threads_running', 'row_lock_waits', 'lock_wait_ms', 'bp_hit_ratio', 'cache_hit_ratio', 'retries', 'deadlocks'],
    r.samples.map((s) => [s.tS, s.tps, s.p50Ms, s.p95Ms, s.p99Ms, s.errors, s.activeVus, s.appQueue, s.poolWaiting, s.threadsRunning, s.rowLockWaits, s.lockWaitMs, s.bpHitRatio, s.cacheHitRatio, s.retries ?? 0, s.deadlocks ?? 0]));
}
