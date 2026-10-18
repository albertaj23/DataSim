// One command: ensure .env -> docker up (wait healthy) -> start server (runs migrations, runner user, templates) + web -> print the URL.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const API = 'http://127.0.0.1:4000/api/health';
const WEB = 'http://127.0.0.1:5173/DataSim/';
const log = (m: string) => console.log(`[demo] ${m}`);

if (!existsSync(path.join(root, '.env'))) {
  copyFileSync(path.join(root, '.env.example'), path.join(root, '.env'));
  log('created .env from .env.example');
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) { console.error(`[demo] \`${cmd} ${args.join(' ')}\` failed. Is Docker Desktop running? Try \`npm run doctor\`.`); process.exit(1); }
}

async function waitFor(url: string, label: string, timeoutMs = 120_000, accept: (status: number) => boolean = (s) => s < 500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const res = await fetch(url); if (accept(res.status)) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`[demo] ${label} did not come up within ${timeoutMs / 1000}s`);
  process.exit(1);
}

log('starting MySQL 8.4 + Redis 7 (docker compose up --wait)');
run('docker', ['compose', 'up', '-d', '--wait']);

const children: ChildProcess[] = [];
function start(name: string, args: string[]) {
  const child = spawn('npm', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin });
  const prefix = (d: Buffer) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  child.stdout?.on('data', prefix); child.stderr?.on('data', prefix);
  child.on('exit', (code) => { if (!stopping) { console.error(`[demo] ${name} exited (${code})`); stop(1); } });
  children.push(child);
}
async function isUp(url: string) { try { return (await fetch(url)).status < 500; } catch { return false; } }
let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const c of children) {
    if (!c.pid) continue;
    if (isWin) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

async function main() {
  if (await isUp(API)) log('API already running on :4000, reusing it');
  else {
    log('starting API (migrations, restricted user, templates run at boot)');
    start('server', ['-w', 'server', 'run', 'start']);
    await waitFor(API, 'API', 120_000, (s) => s === 200);
  }
  if (await isUp(WEB)) log('web already running on :5173, reusing it');
  else {
    if (process.env.DEMO_DEV) start('web', ['-w', 'web', 'run', 'dev']);
    else {
      // Production build + preview: stable for a live demo (no HMR surprises while files change) and lighter on the laptop.
      log('building web (set DEMO_DEV=1 for the Vite dev server)');
      run('npm', ['-w', 'web', 'run', 'build']);
      start('web', ['-w', 'web', 'run', 'preview', '--', '--port', '5173', '--strictPort']);
    }
    await waitFor(WEB, 'web');
  }

  console.log(`\n  DataSim is running\n\n    ${WEB}\n\n  Ctrl+C to stop (containers keep running; \`npm run db:down\` stops them)\n`);

}
void main();
