// Preflight: Docker, ports, MySQL version, performance_schema, Redis, restricted runner user.
// Usage: npm run doctor   (exit code 1 when a required check fails)
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import mysql from 'mysql2/promise';
import { Redis } from 'ioredis';
import { config } from '../server/src/config.js';

type Result = { name: string; ok: boolean; detail: string; required?: boolean };
const results: Result[] = [];
const add = (name: string, ok: boolean, detail: string, required = true) => results.push({ name, ok, detail, required });

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  add('Node.js >= 20', major >= 20, `v${process.versions.node}`);

  try {
    const v = execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }).toString().trim();
    add('Docker daemon', true, `server ${v}`);
  } catch {
    add('Docker daemon', false, 'not reachable: start Docker Desktop, then run `npm run demo`');
  }

  let admin: mysql.Connection | null = null;
  try {
    admin = await mysql.createConnection({ host: config.DB_HOST, port: config.DB_PORT, user: config.DB_USER, password: config.DB_PASSWORD });
    const [v] = (await admin.query('SELECT VERSION() AS v')) as [Array<{ v: string }>, unknown];
    add('MySQL 8.4', /^8\.4\./.test(v[0]!.v), `${v[0]!.v} on ${config.DB_HOST}:${config.DB_PORT}`);
    const [ps] = (await admin.query("SHOW VARIABLES LIKE 'performance_schema'")) as [Array<{ Value: string }>, unknown];
    add('performance_schema ON', ps[0]?.Value === 'ON', String(ps[0]?.Value));
    const [mc] = (await admin.query("SHOW VARIABLES LIKE 'max_connections'")) as [Array<{ Value: string }>, unknown];
    add('max_connections >= 300', Number(mc[0]?.Value) >= 300, String(mc[0]?.Value), false);
    const [u] = (await admin.query('SELECT COUNT(*) AS n FROM mysql.user WHERE user = ?', [config.RUNNER_USER])) as [Array<{ n: number }>, unknown];
    add('Restricted user exists', Number(u[0]?.n) > 0, Number(u[0]?.n) > 0 ? config.RUNNER_USER : `${config.RUNNER_USER} missing (created when the server starts)`, false);
  } catch (err) {
    add('MySQL reachable', false, `${(err as Error).message}. Run \`npm run db:up\``);
  } finally { await admin?.end().catch(() => undefined); }

  const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 2000, retryStrategy: () => null });
  redis.on('error', () => undefined);
  try { await redis.connect(); await redis.ping(); add('Redis 7', true, config.REDIS_URL); }
  catch (err) { add('Redis 7', false, `${(err as Error).message}. Run \`npm run db:up\``); }
  finally { redis.disconnect(); }

  for (const [port, what] of [[config.PORT, 'API'], [5173, 'web']] as const) {
    const free = await portFree(port);
    add(`Port ${port} (${what})`, true, free ? 'free' : 'in use (fine if DataSim is already running)', false);
  }

  let failed = false;
  for (const r of results) {
    console.log(`${r.ok ? '  ok ' : r.required === false ? ' warn' : ' FAIL'}  ${r.name.padEnd(26)} ${r.detail}`);
    if (!r.ok && r.required !== false) failed = true;
  }
  console.log(failed ? '\nPreflight failed.' : '\nPreflight passed.');
  process.exit(failed ? 1 : 0);
}
void main();
