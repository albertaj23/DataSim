import { Router } from 'express';
import { z } from 'zod';
import { DesignDoc, emptyDesign } from '@datasim/shared';
import type { FindingFix, ValidateResponse } from '@datasim/shared';
import { ServiceError } from '../services/liveStrategy.js';
import { applyFix, archiveProject, createProjectFromDesign, duplicateProject, getDraft, getProject, getRevision, listProjects, listRevisions, pinCurrent, saveDraft, updateProject } from '../projects/service.js';
import { validateDesignFull } from '../projects/scratch.js';
import { instantiateTemplate } from '../templates/index.js';
import { asyncHandler } from './http.js';

export const projectsRouter = Router();

const idOf = (v: unknown) => z.string().uuid().parse(v);
const CreateBody = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).optional(), templateKey: z.string().optional() });
const PatchBody = z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(500).optional() });
const NoteBody = z.object({ note: z.string().max(200).optional() }).default({});
const FixSchema: z.ZodType<FindingFix> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ADD_INDEX'), table: z.string(), columns: z.array(z.string()).min(1), name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/) }),
  z.object({ type: z.literal('SET_STRATEGY'), strategy: z.enum(['default', 'naive', 'pessimistic', 'optimistic', 'atomic', 'serializable']) }),
  z.object({ type: z.literal('SET_POOL'), poolSize: z.number().int().min(1).max(100) }),
  z.object({ type: z.literal('SET_INSTANCES'), instances: z.number().int().min(1).max(8) }),
  z.object({ type: z.literal('ADD_CHECK'), table: z.string(), expr: z.string().min(1) }),
]);

projectsRouter.get('/projects', asyncHandler(async (req, res) => {
  res.json(await listProjects({ includeArchived: req.query.includeArchived === 'true' }));
}));

projectsRouter.post('/projects', asyncHandler(async (req, res) => {
  const b = CreateBody.parse(req.body);
  const id = b.templateKey
    ? await instantiateTemplate(b.templateKey, b.name, b.description)
    : await createProjectFromDesign(b.name, emptyDesign(), { description: b.description });
  res.status(201).json(await getProject(id));
}));

projectsRouter.get('/projects/:id', asyncHandler(async (req, res) => {
  const p = await getProject(idOf(req.params.id));
  if (!p) throw new ServiceError(404, 'NOT_FOUND', 'Project not found');
  res.json(p);
}));

projectsRouter.patch('/projects/:id', asyncHandler(async (req, res) => {
  res.json(await updateProject(idOf(req.params.id), PatchBody.parse(req.body)));
}));

projectsRouter.post('/projects/:id/archive', asyncHandler(async (req, res) => {
  await archiveProject(idOf(req.params.id));
  res.json({ ok: true });
}));

projectsRouter.post('/projects/:id/duplicate', asyncHandler(async (req, res) => {
  res.status(201).json(await getProject(await duplicateProject(idOf(req.params.id))));
}));

projectsRouter.get('/projects/:id/draft', asyncHandler(async (req, res) => {
  const p = await getProject(idOf(req.params.id));
  if (!p) throw new ServiceError(404, 'NOT_FOUND', 'Project not found');
  res.json({ design: p.design, updatedAt: p.draftUpdatedAt });
}));

projectsRouter.put('/projects/:id/draft', asyncHandler(async (req, res) => {
  // Accepts either the bare design or { design }.
  const raw = req.body && typeof req.body === 'object' && 'design' in req.body && !('nodes' in req.body) ? req.body.design : req.body;
  res.json(await saveDraft(idOf(req.params.id), DesignDoc.parse(raw)));
}));

projectsRouter.post('/projects/:id/revisions', asyncHandler(async (req, res) => {
  const { note } = NoteBody.parse(req.body);
  const r = await pinCurrent(idOf(req.params.id), note);
  res.status(r.created ? 201 : 200).json({ revisionNo: r.revisionNo, created: r.created });
}));

projectsRouter.get('/projects/:id/revisions', asyncHandler(async (req, res) => {
  const id = idOf(req.params.id);
  if (!(await getProject(id))) throw new ServiceError(404, 'NOT_FOUND', 'Project not found');
  res.json(await listRevisions(id));
}));

projectsRouter.get('/projects/:id/revisions/:n', asyncHandler(async (req, res) => {
  const r = await getRevision(idOf(req.params.id), z.coerce.number().int().min(1).parse(req.params.n));
  if (!r) throw new ServiceError(404, 'NOT_FOUND', 'Revision not found');
  res.json(r);
}));

projectsRouter.post('/projects/:id/validate', asyncHandler(async (req, res) => {
  const id = idOf(req.params.id);
  // Optional body { design } validates unsaved editor state; default is the saved draft.
  const design = req.body?.design ? DesignDoc.parse(req.body.design) : await getDraft(id);
  const problems = await validateDesignFull(id, design);
  const body: ValidateResponse = { problems, errorCount: problems.filter((p) => p.severity === 'error').length, warningCount: problems.filter((p) => p.severity === 'warning').length };
  res.json(body);
}));

projectsRouter.post('/projects/:id/apply-fix', asyncHandler(async (req, res) => {
  const b = z.object({ fix: FixSchema, note: z.string().max(200).optional() }).parse(req.body);
  const r = await applyFix(idOf(req.params.id), b.fix, b.note);
  res.json({ revisionNo: r.revisionNo });
}));
