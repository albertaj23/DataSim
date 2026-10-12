import { Router } from 'express';
import { z } from 'zod';
import { generateDdl, SchemaModel } from '@datasim/shared';
import type { DdlResponse } from '@datasim/shared';
import { importDdl } from '../projects/importDdl.js';
import { asyncHandler } from './http.js';
import { ServiceError } from '../services/liveStrategy.js';
import { MAX_ATTRS, normalize, parseFds } from '../../../shared/src/normalize.js';

export const schemaRouter = Router();

schemaRouter.post('/schema/ddl', asyncHandler(async (req, res) => {
  const raw = req.body && 'schema' in req.body && !('tables' in req.body) ? req.body.schema : req.body;
  const body: DdlResponse = generateDdl(SchemaModel.parse(raw));
  res.json(body);
}));

schemaRouter.post('/schema/import', asyncHandler(async (req, res) => {
  res.json(await importDdl(z.object({ ddl: z.string().min(1).max(200_000) }).parse(req.body).ddl));
}));

// ponytail: relative import until the lead exports ./normalize from shared/src/index.ts; then import from '@datasim/shared'.
const NormalizeBody = z.object({
  attributes: z.array(z.string().min(1)).min(1).max(MAX_ATTRS),
  /** Either structured FDs or text lines such as "A, B -> C". */
  fds: z.union([z.array(z.object({ lhs: z.array(z.string()).min(1), rhs: z.array(z.string()).min(1) })), z.string()]),
  closureOf: z.array(z.string()).optional(),
});

schemaRouter.post('/normalize', asyncHandler(async (req, res) => {
  const b = NormalizeBody.parse(req.body);
  try {
    res.json(normalize(b.attributes, typeof b.fds === 'string' ? parseFds(b.fds) : b.fds, b.closureOf));
  } catch (e) { throw new ServiceError(400, 'BAD_FDS', (e as Error).message); }
}));
