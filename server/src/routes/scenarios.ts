import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from './http.js';
import { ServiceError } from '../services/playback.js';
import {
  archiveWorkspace,
  cancelRun,
  createBlankWorkspace,
  duplicateWorkspace,
  getRun,
  getRunEvents,
  getRunSnapshot,
  getScenarioTemplates,
  getWorkspace,
  instantiateTemplate,
  listRevisions,
  listRuns,
  listWorkspaces,
  patchWorkspaceMetadata,
  restoreWorkspace,
  saveWorkspaceDefinition,
  startRun,
  validateWorkspace,
} from '../core/scenario/workspaces.js';
import { workspaceDefinitionSchema } from '../core/scenario/schema.js';
import {
  cancelExperimentBatch,
  createExperimentBatch,
  getExperimentBatch,
  listExperimentBatches,
} from '../core/scenario/batches.js';

export const scenariosRouter = Router();

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
}).strict();
const metadataSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide a name or description to update.');
const duplicateSchema = z.object({ name: z.string().trim().min(1).max(120).optional() }).strict().default({});
const templateSchema = z.object({ name: z.string().trim().min(1).max(120).optional() }).strict().default({});
const runSchema = z.object({
  runMode: z.enum(['LIVE_DBMS', 'GUIDED_SCHEDULE']),
  isolation: z.enum(['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']),
  concurrency: z.number().int().min(1).max(8).optional(),
  trials: z.number().int().min(1).max(10),
  seed: z.number().int().min(0).max(2_147_483_647),
  timeoutMs: z.number().int().min(2_000).max(30_000),
}).strict();

function notFound(kind: string, id: string): never {
  throw new ServiceError(404, 'NOT_FOUND', `${kind} "${id}" was not found.`);
}

function routeId(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) throw new ServiceError(400, 'BAD_REQUEST', `Missing route parameter "${name}".`);
  return value;
}

scenariosRouter.get('/templates', (_req, res) => { res.json(getScenarioTemplates()); });

scenariosRouter.post('/templates/:id/instantiate', asyncHandler(async (req, res) => {
  const body = templateSchema.parse(req.body ?? {});
  const id = routeId(req, 'id');
  const workspace = await instantiateTemplate(id, body.name);
  if (!workspace) return notFound('Template', id);
  res.status(201).json(workspace);
}));

scenariosRouter.get('/scenarios', (_req, res) => { res.json(getScenarioTemplates()); });

scenariosRouter.get('/workspaces', asyncHandler(async (req, res) => {
  const search = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
  const includeArchived = req.query.archived === 'true';
  res.json(await listWorkspaces(search, includeArchived));
}));

scenariosRouter.post('/workspaces', asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  res.status(201).json(await createBlankWorkspace(body.name, body.description));
}));

scenariosRouter.get('/workspaces/:id', asyncHandler(async (req, res) => {
  const id = routeId(req, 'id');
  const workspace = await getWorkspace(id);
  if (!workspace) return notFound('Workspace', id);
  res.json(workspace);
}));

scenariosRouter.patch('/workspaces/:id', asyncHandler(async (req, res) => {
  const body = metadataSchema.parse(req.body);
  const id = routeId(req, 'id');
  const workspace = await patchWorkspaceMetadata(id, body);
  if (!workspace) return notFound('Active workspace', id);
  res.json(workspace);
}));

scenariosRouter.put('/workspaces/:id/definition', asyncHandler(async (req, res) => {
  const parsed = workspaceDefinitionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ServiceError(400, 'INVALID_DEFINITION', 'The workspace definition is not valid.', {
      problems: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  const id = routeId(req, 'id');
  const workspace = await saveWorkspaceDefinition(id, parsed.data);
  if (!workspace) return notFound('Active workspace', id);
  res.json(workspace);
}));

scenariosRouter.get('/workspaces/:id/revisions', asyncHandler(async (req, res) => {
  const id = routeId(req, 'id');
  if (!(await getWorkspace(id))) return notFound('Workspace', id);
  res.json(await listRevisions(id));
}));

scenariosRouter.post('/workspaces/:id/validate', asyncHandler(async (req, res) => {
  const id = routeId(req, 'id');
  const result = await validateWorkspace(id);
  if (!result) return notFound('Workspace', id);
  res.json({
    ...result,
    capabilities: {
      engine: 'MySQL/InnoDB',
      modes: ['LIVE_DBMS', 'GUIDED_SCHEDULE'],
      isolationLevels: ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'],
      maxActors: 8, maxTrials: 10, supportsActorConcurrency: true,
      maxBatchCells: 12, maxBatchActorTrials: 240,
    },
  });
}));

scenariosRouter.post('/workspaces/:id/duplicate', asyncHandler(async (req, res) => {
  const body = duplicateSchema.parse(req.body ?? {});
  const id = routeId(req, 'id');
  const workspace = await duplicateWorkspace(id, body.name);
  if (!workspace) return notFound('Workspace', id);
  res.status(201).json(workspace);
}));

scenariosRouter.delete('/workspaces/:id', asyncHandler(async (req, res) => {
  const id = routeId(req, 'id');
  if (!(await archiveWorkspace(id))) return notFound('Active workspace', id);
  res.status(204).end();
}));

scenariosRouter.post('/workspaces/:id/restore', asyncHandler(async (req, res) => {
  const id = routeId(req, 'id');
  if (!(await restoreWorkspace(id))) return notFound('Archived workspace', id);
  res.status(204).end();
}));

scenariosRouter.post('/workspaces/:id/runs', asyncHandler(async (req, res) => {
  const id = routeId(req, 'id');
  const result = await startRun(id, runSchema.parse(req.body));
  if ('error' in result) {
    if (result.error === 'NOT_FOUND') return notFound('Active workspace', id);
    if (result.error === 'VALIDATION') {
      throw new ServiceError(422, 'WORKSPACE_INVALID', 'Fix the validation problems before starting a run.', { problems: result.problems });
    }
    throw new ServiceError(400, 'BAD_CONFIGURATION', 'Run configuration is invalid.', { problems: result.problems });
  }
  res.status(202).json(result);
}));

scenariosRouter.post('/workspaces/:id/batches', asyncHandler(async (req, res) => {
  const id = routeId(req, 'id');
  const result = await createExperimentBatch(id, req.body);
  if ('error' in result) {
    if (result.error === 'NOT_FOUND') return notFound('Active workspace', id);
    if (result.error === 'VALIDATION') {
      throw new ServiceError(422, 'WORKSPACE_INVALID', 'Fix the validation problems before starting an experiment batch.', { problems: result.problems });
    }
    throw new ServiceError(400, 'BAD_CONFIGURATION', 'Experiment batch configuration is invalid.', { problems: result.problems });
  }
  res.status(202).json(result);
}));

scenariosRouter.get('/batches', asyncHandler(async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  res.json(await listExperimentBatches(workspaceId));
}));

scenariosRouter.get('/batches/:id', asyncHandler(async (req, res) => {
  const id = routeId(req, 'id');
  const batch = await getExperimentBatch(id);
  if (!batch) return notFound('Experiment batch', id);
  res.json(batch);
}));

scenariosRouter.post('/batches/:id/cancel', asyncHandler(async (req, res) => {
  const id = routeId(req, 'id');
  const result = await cancelExperimentBatch(id);
  if (result.status === undefined) return notFound('Experiment batch', id);
  res.json(result);
}));

scenariosRouter.get('/runs', asyncHandler(async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  res.json(await listRuns(workspaceId));
}));

scenariosRouter.get('/runs/:id', asyncHandler(async (req, res) => {
  const id = routeId(req, 'id');
  const run = await getRun(id);
  if (!run) return notFound('Run', id);
  res.json(run);
}));

scenariosRouter.get('/runs/:id/events', asyncHandler(async (req, res) => {
  const id = routeId(req, 'id');
  const events = await getRunEvents(id);
  if (!events) return notFound('Run', id);
  res.json(events);
}));

scenariosRouter.get('/runs/:id/snapshot', asyncHandler(async (req, res) => {
  const id = routeId(req, 'id');
  const snapshot = await getRunSnapshot(id);
  if (!snapshot) return notFound('Run', id);
  res.json(snapshot);
}));

scenariosRouter.post('/runs/:id/cancel', asyncHandler(async (req, res) => {
  const id = routeId(req, 'id');
  const result = await cancelRun(id);
  if (result.status === undefined) return notFound('Run', id);
  res.json(result);
}));
