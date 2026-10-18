import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { labRouter } from './routes/lab.js';
import { errorHandler } from './routes/http.js';
import { runsRouter } from './routes/runs.js';
import { sandboxRouter } from './routes/sandbox.js';
import { stepperRouter } from './routes/stepper.js';
import { projectsRouter } from './routes/projects.js';
import { templatesRouter } from './routes/templates.js';
import { schemaRouter } from './routes/schema.js';

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', healthRouter, labRouter, stepperRouter, projectsRouter, templatesRouter, schemaRouter, runsRouter, sandboxRouter);
  app.use(errorHandler);
  return app;
}
