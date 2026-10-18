import { Router } from 'express';
import { z } from 'zod';
import { getProject } from '../projects/service.js';
import { instantiateTemplate, listTemplates } from '../templates/index.js';
import { asyncHandler } from './http.js';

export const templatesRouter = Router();

templatesRouter.get('/templates', (_req, res) => { res.json(listTemplates()); });

templatesRouter.post('/templates/:key/instantiate', asyncHandler(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(500).optional() }).default({}).parse(req.body);
  const id = await instantiateTemplate(req.params.key!, b.name, b.description);
  res.status(201).json(await getProject(id));
}));
