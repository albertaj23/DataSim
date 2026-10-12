import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { labRouter } from './routes/lab.js';
import { errorHandler } from './routes/http.js';
import { stepperRouter } from './routes/stepper.js';

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', healthRouter, labRouter, stepperRouter);
  app.use(errorHandler);
  return app;
}
