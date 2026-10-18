import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { closePools } from './db/pool.js';
import { attachSocket } from './realtime/socket.js';
import { engine as stepperEngine } from './lab/stepper/engine.js';
import { closeRedis } from './db/redis.js';
import { setLiveStrategy } from './services/liveStrategy.js';
import { runMigrations } from './db/migrations.js';
import { ensureRunnerUser } from './db/runner.js';
import { seedTemplates } from './templates/index.js';

await runMigrations();
await ensureRunnerUser();
await setLiveStrategy(config.DEFAULT_STRATEGY);
await seedTemplates();

const server = http.createServer(createApp());
const io = attachSocket(server);

server.listen(config.PORT, '0.0.0.0', () => {
  console.log(`datasim server listening on http://0.0.0.0:${config.PORT}`);
});

async function shutdown() {
  io.close();
  server.close();
  await stepperEngine.closeAll();
  await closeRedis();
  await closePools();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
