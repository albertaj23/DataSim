import { Router } from 'express';
import { z } from 'zod';
import { SOCKET_EVENTS } from '@datasim/shared';
import { provisionSandbox, sandboxQuery, testTransaction } from '../engine/index.js';
import { getDraft } from '../projects/service.js';
import { emitRun } from '../realtime/runEmitter.js';
import { asyncHandler } from './http.js';

export const sandboxRouter = Router();
const Id = z.string().uuid();

/** Provision progress is emitted to the room `run:<projectId>` (the event's runId is the project id). */
sandboxRouter.post('/projects/:id/sandbox/provision', asyncHandler(async (req, res) => {
  const projectId = Id.parse(req.params.id);
  const body = z.object({ rowScale: z.number().min(0.001).max(10).optional() }).default({}).parse(req.body ?? {});
  const design = await getDraft(projectId);
  res.json(await provisionSandbox(projectId, design, { rowScale: body.rowScale, runId: projectId, onProgress: (e) => emitRun(projectId, SOCKET_EVENTS.progress, e) }));
}));

sandboxRouter.post('/projects/:id/sandbox/test-txn', asyncHandler(async (req, res) => {
  const projectId = Id.parse(req.params.id);
  const body = z.object({ txnName: z.string().min(1), variant: z.string().optional() }).parse(req.body);
  res.json(await testTransaction(projectId, await getDraft(projectId), body));
}));

sandboxRouter.post('/projects/:id/sandbox/query', asyncHandler(async (req, res) => {
  const projectId = Id.parse(req.params.id);
  const { sql } = z.object({ sql: z.string().min(1).max(20_000) }).parse(req.body);
  res.json(await sandboxQuery(projectId, sql));
}));
