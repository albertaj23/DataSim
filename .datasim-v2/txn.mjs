const pid = process.argv[2];
const runs = await (await fetch(`http://127.0.0.1:4000/api/runs?projectId=${pid}`)).json();
for (const r of runs.reverse()) {
  const rep = await (await fetch(`http://127.0.0.1:4000/api/runs/${r.runId}`)).json();
  console.log(r.kind, r.strategy, 'rev', r.revisionNo, 'p95', r.p95Ms, 'tps', r.tpsAvg);
  for (const t of rep.txnStats) console.log('   ', t.txnName, 'n', t.count, 'p50', t.p50Ms, 'p95', t.p95Ms, 'q', t.queueMs, 'pool', t.poolMs, 'db', t.dbMs);
  const s = rep.statementStats.find((x) => /slot/.test(x.digestText));
  if (s) console.log('    search stmt avg', s.avgMs, 'rowsExamined', s.rowsExamined, 'noIndex', s.noIndexUsed);
}
