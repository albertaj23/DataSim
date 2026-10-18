import { createHash } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import type { DesignDoc, TemplateInfo } from '@datasim/shared';
import { appPool } from '../db/pool.js';
import { createProjectFromDesign } from '../projects/service.js';
import { dropStaleScratchSchemas } from '../projects/scratch.js';
import { ServiceError } from '../services/liveStrategy.js';
import { buildCourseRegistration } from './t1CourseRegistration.js';
import { buildSharedResource } from './t2SharedResource.js';
import { buildFlashSale } from './t3FlashSale.js';
import { buildBankTransfers } from './t4BankTransfers.js';

interface TemplateDef extends TemplateInfo { build: () => DesignDoc }

export const TEMPLATES: TemplateDef[] = [
  {
    key: 'course-registration', name: 'Course Registration Rush', tier: 1,
    summary: 'FFCS-style registration: 150 students race for seats in 24,000 sections.',
    tags: ['overbooking', 'locks', 'capacity'], build: buildCourseRegistration,
  },
  {
    key: 'shared-resource', name: 'Review 1: Shared Resource Allocation', tier: 1,
    summary: 'Accounts claim shared resources under a quota. The Review 1 entities as real tables.',
    tags: ['quota', 'lost update', 'strategies'], build: buildSharedResource,
  },
  {
    key: 'flash-sale', name: 'Flash Sale Checkout', tier: 2,
    summary: 'Hot SKUs sell out under a zipf load. A CHECK constraint is itself a concurrency strategy.',
    tags: ['overselling', 'constraints', 'hot rows'], build: buildFlashSale,
  },
  {
    key: 'bank-transfers', name: 'Bank Transfers and Deadlocks', tier: 2,
    summary: 'Opposite transfers deadlock; ordered locking removes the deadlocks.',
    tags: ['deadlock', 'lock order', 'retries'], build: buildBankTransfers,
  },
];

const def = (key: string) => TEMPLATES.find((t) => t.key === key) ?? (() => { throw new ServiceError(404, 'NOT_FOUND', `Unknown template ${key}`); })();

export const listTemplates = (): TemplateInfo[] => TEMPLATES.map(({ build: _b, ...info }) => info);
export const buildTemplate = (key: string): DesignDoc => def(key).build();

/** Stable id of the seeded master project of a template, so seeding is idempotent without a lookup race. */
export function templateProjectId(key: string): string {
  const h = createHash('sha1').update(`datasim-template:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Copies a template into a new, editable project. */
export async function instantiateTemplate(key: string, name?: string, description?: string): Promise<string> {
  const t = def(key);
  return createProjectFromDesign(name ?? t.name, t.build(), { description: description ?? t.summary, templateKey: key });
}

/**
 * Create-if-missing: each template exists as an archived master project (stable id, template_key set).
 * Archived so it stays out of the Projects list; instantiate copies from code, never from the master.
 */
export async function seedTemplates(): Promise<void> {
  await dropStaleScratchSchemas();
  for (const t of TEMPLATES) {
    const id = templateProjectId(t.key);
    const [rows] = await appPool.query<RowDataPacket[]>('SELECT project_id FROM project WHERE project_id = ?', [id]);
    if (rows.length === 0) await createProjectFromDesign(t.name, t.build(), { description: t.summary, templateKey: t.key, projectId: id, archived: true });
  }
}
