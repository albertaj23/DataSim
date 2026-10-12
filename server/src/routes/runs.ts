import { Router } from 'express';
import { z } from 'zod';
import { RunOverrides, RunRequest } from '@datasim/shared';
import type { CompareResponse, CompareStrategiesResponse, RunListQuery, StartRunResponse } from '@datasim/shared';
import { cancelRun, listRuns, loadReport, recoverStaleRuns, reportToCsv, reportToMarkdown, startRun, startStrategyCompare } from '../engine/index.js';
import { pinCurrent } from '../projects/service.js';
import { ServiceError } from '../services/liveStrategy.js';
import { asyncHandler } from './http.js';

export const runsRouter = Router();

// Server restart: runs left non-terminal by a previous process are marked FAILED (skipped when a run is live or the DB is not migrated yet).
void recoverStaleRuns().catch(() => undefined);

const Id = z.string().uuid();
const ListQuery = z.object({ projectId: Id.optional(), kind: z.enum(['LOAD', 'CAPACITY', 'STRATEGY_CHILD']).optional(), verdict: z.enum(['pass', 'fail']).optional() });

runsRouter.post('/projects/:id/runs', asyncHandler(async (req, res) => {
  const projectId = Id.parse(req.params.id);
  const body = RunRequest.parse(req.body ?? {});
  const pinned = await pinCurrent(projectId, 'Pinned for run');
  const { runId } = await startRun({ projectId, revisionNo: pinned.revisionNo, design: pinned.design, kind: body.kind, overrides: body.overrides });
  res.status(202).json({ runId } satisfies StartRunResponse);
}));

runsRouter.get('/runs', asyncHandler(async (req, res) => {
  const q = ListQuery.parse(req.query) satisfies RunListQuery;
  res.json(await listRuns(q));
}));

runsRouter.get('/runs/:id', asyncHandler(async (req, res) => {
  const report = await loadReport(Id.parse(req.params.id));
  if (!report) throw new ServiceError(404, 'NOT_FOUND', 'Run not found');
  res.json(report);
}));

runsRouter.post('/runs/:id/cancel', asyncHandler(async (req, res) => {
  if (!(await cancelRun(Id.parse(req.params.id)))) throw new ServiceError(409, 'RUN_NOT_ACTIVE', 'This run is not active, so there is nothing to cancel');
  res.json({ ok: true });
}));

runsRouter.get('/runs/:id/export.md', asyncHandler(async (req, res) => {
  const id = Id.parse(req.params.id);
  const report = await loadReport(id);
  if (!report) throw new ServiceError(404, 'NOT_FOUND', 'Run not found');
  res.type('text/markdown').set('Content-Disposition', `attachment; filename="datasim-run-${id.slice(0, 8)}.md"`).send(reportToMarkdown(report));
}));

runsRouter.get('/runs/:id/export.csv', asyncHandler(async (req, res) => {
  const id = Id.parse(req.params.id);
  const report = await loadReport(id);
  if (!report) throw new ServiceError(404, 'NOT_FOUND', 'Run not found');
  const part = req.query.part === 'txn' ? 'txn' : 'samples';
  res.type('text/csv').set('Content-Disposition', `attachment; filename="datasim-run-${id.slice(0, 8)}-${part}.csv"`).send(reportToCsv(report, part));
}));

runsRouter.post('/compare', asyncHandler(async (req, res) => {
  const { runIds } = z.object({ runIds: z.array(Id).min(2).max(4) }).parse(req.body);
  const reports = await Promise.all(runIds.map((id) => loadReport(id)));
  const missing = runIds.filter((_, i) => !reports[i]);
  if (missing.length) throw new ServiceError(404, 'NOT_FOUND', `Run not found: ${missing.join(', ')}`);
  const runs = reports as NonNullable<(typeof reports)[number]>[];
  if (new Set(runs.map((r) => r.run.projectId)).size > 1) throw new ServiceError(400, 'DIFFERENT_PROJECTS', 'Compare runs from the same project');
  res.json({ runs } satisfies CompareResponse);
}));

runsRouter.post('/projects/:id/compare-strategies', asyncHandler(async (req, res) => {
  const projectId = Id.parse(req.params.id);
  const overrides = RunOverrides.parse((req.body as { overrides?: unknown } | undefined)?.overrides ?? {});
  const pinned = await pinCurrent(projectId, 'Pinned for strategy comparison');
  const { parentRunId, runIds } = await startStrategyCompare({ projectId, revisionNo: pinned.revisionNo, design: pinned.design, overrides });
  res.status(202).json({ parentRunId, runIds } satisfies CompareStrategiesResponse);
}));
