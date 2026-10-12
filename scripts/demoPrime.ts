// Runs every run in docs/DEMO.md headlessly through the API so the reports already exist as a fallback.
// Usage: npm run demo:prime   (starts the API itself if it is not already running)
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { ProjectDetail, RunReport } from '@datasim/shared';

const API = 'http://127.0.0.1:4000/api';
const isWin = process.platform === 'win32';
const log = (m: string) => console.log(`[prime] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

async function up() { try { return (await fetch(`${API}/health`)).status === 200; } catch { return false; } }

async function waitIdle() {
  for (let i = 0; i < 240; i++) {
    const h = await call<{ activeRunId: string | null }>('GET', '/health');
    if (!h.body.activeRunId) return;
    await sleep(1000);
  }
}

async function runAndWait(projectId: string, kind: 'LOAD' | 'CAPACITY', overrides: Record<string, unknown>, label: string): Promise<RunReport> {
  await waitIdle();
  log(`${label}: starting ${kind}`);
  const started = await call<{ runId: string; code?: string; message?: string }>('POST', `/projects/${projectId}/runs`, { kind, overrides });
  if (started.status >= 300) throw new Error(`${label}: ${started.body.code} ${started.body.message}`);
  const runId = started.body.runId;
  for (;;) {
    await sleep(2000);
    const r = await call<RunReport>('GET', `/runs/${runId}`);
    const s = r.body.run?.status;
    if (s === 'COMPLETED' || s === 'FAILED' || s === 'CANCELLED') {
      if (s !== 'COMPLETED') throw new Error(`${label}: run ${s}: ${r.body.run.errorText}`);
      const viol = r.body.invariants.reduce((n, i) => n + i.violations, 0);
      log(`${label}: done · ${r.body.run.tpsAvg} tps · p95 ${r.body.run.p95Ms} ms · violations ${viol} · SLO ${r.body.run.sloPass ? 'PASS' : 'FAIL'}`);
      return r.body;
    }
  }
}

async function main() {
  let child: ChildProcess | null = null;
  if (!(await up())) {
    log('API not running: starting it');
    spawnSync('docker', ['compose', 'up', '-d', '--wait'], { stdio: 'inherit', shell: isWin });
    child = spawn('npm', ['-w', 'server', 'run', 'start'], { stdio: 'ignore', shell: isWin });
    for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
    if (!(await up())) throw new Error('API did not start');
  }
  try {
    const inst = await call<ProjectDetail>('POST', '/templates/course-registration/instantiate', { name: 'Course Registration Rush (primed)' });
    if (inst.status >= 300) throw new Error('could not instantiate the template');
    const projectId = inst.body.projectId;
    log(`project ${projectId}`);

    await runAndWait(projectId, 'LOAD', { strategy: 'naive' }, '1 naive');
    const atomic = await runAndWait(projectId, 'LOAD', { strategy: 'atomic' }, '2 atomic');
    const scan = atomic.findings.find((f) => f.kind === 'FULL_SCAN' && f.fix);
    if (scan?.fix) {
      const applied = await call<{ revisionNo: number }>('POST', `/projects/${projectId}/apply-fix`, { fix: scan.fix });
      log(`applied advisor fix "${scan.title}" -> rev ${applied.body.revisionNo}`);
      await runAndWait(projectId, 'LOAD', { strategy: 'atomic' }, '3 atomic + index');
    } else log('no FULL_SCAN finding to apply (index step skipped)');
    await runAndWait(projectId, 'CAPACITY', { strategy: 'atomic' }, '4 capacity');
    log(`done. Open http://localhost:5173/DataSim/ -> Runs, or /p/${projectId}`);
  } finally {
    if (child?.pid) { if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill('SIGTERM'); }
  }
}
main().then(() => process.exit(0), (e) => { console.error(`[prime] ${e.message}`); process.exit(1); });
