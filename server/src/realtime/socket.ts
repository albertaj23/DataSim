import type http from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { setStepperEmitter } from '../lab/stepper/emitter.js';
import { setPublisher, type Publisher } from './publisher.js';
import { setRunEmitter } from './runEmitter.js';

// Rooms: `stepper` receives `stepper_update`; `run:<id>` receives run:status, run:provision-progress,
// run:sample (1 Hz), run:locks (<= 2 Hz) and run:finished (see @datasim/shared socket events).
const RunId = z.object({ runId: z.string().min(1).max(64) });

export function attachSocket(server: http.Server): Server {
  const io = new Server(server, { cors: { origin: true } });

  // The strategies/service layer still announces account changes; nothing in v2 watches them.
  const publisher: Publisher = { accountChanged() {}, sessionLost() {}, strategyChanged() {} };
  setPublisher(publisher);
  setStepperEmitter((update) => { io.to('stepper').emit('stepper_update', update); });
  setRunEmitter((runId, event, payload) => { io.to(`run:${runId}`).emit(event, payload); });

  io.on('connection', (socket: Socket) => {
    socket.on('join_stepper', async (_raw: unknown, ack?: (res: object) => void) => {
      await socket.join('stepper');
      ack?.({ ok: true });
    });
    socket.on('join_run', async (raw: unknown, ack?: (res: object) => void) => {
      const parsed = RunId.safeParse(raw);
      if (!parsed.success) { ack?.({ ok: false }); return; }
      await socket.join(`run:${parsed.data.runId}`);
      ack?.({ ok: true });
    });
    socket.on('leave_run', async (raw: unknown) => {
      const parsed = RunId.safeParse(raw);
      if (parsed.success) await socket.leave(`run:${parsed.data.runId}`);
    });
  });

  return io;
}
