import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { emptyDesign, hasErrors, validateDesign } from '@datasim/shared';
import type { DesignDoc } from '@datasim/shared';
import { createApp } from '../../src/app.js';
import { appPool, closePools } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrations.js';
import { applyFix, createProjectFromDesign, getDraft, getProject, getRevision, pinCurrent, saveDraft } from '../../src/projects/service.js';
import { buildTemplate, instantiateTemplate, listTemplates, seedTemplates, TEMPLATES, templateProjectId } from '../../src/templates/index.js';
import { validateDesignFull, withScratchSchema, applySchemaDdl } from '../../src/projects/scratch.js';

const app = createApp();
const created: string[] = [];
const track = (id: string) => { created.push(id); return id; };

beforeAll(runMigrations);
afterAll(async () => {
  if (created.length) await appPool.query('DELETE FROM project WHERE project_id IN (?)', [created]);
  await closePools();
});

describe('project service', () => {
  it('creates, saves a draft, pins revisions and reuses identical hashes', async () => {
    const id = track(await createProjectFromDesign('svc test', emptyDesign()));
    expect((await getProject(id))!.dirty).toBe(true);
    const r1 = await pinCurrent(id, 'first');
    expect(r1).toMatchObject({ revisionNo: 1, created: true });
    expect((await pinCurrent(id)).created).toBe(false);
    expect((await getProject(id))!.dirty).toBe(false);

    const d = await getDraft(id);
    d.seed = 99;
    await saveDraft(id, d);
    expect((await getProject(id))!.dirty).toBe(true);
    expect(await pinCurrent(id, 'second')).toMatchObject({ revisionNo: 2, created: true });
    // back to the old content: reuses revision 1 instead of violating the unique hash
    d.seed = 42;
    await saveDraft(id, d);
    expect(await pinCurrent(id)).toMatchObject({ revisionNo: 1, created: false });
    expect((await getRevision(id, 2))!.design.seed).toBe(99);
    expect(await getRevision(id, 9)).toBeNull();
  });

  it('applyFix handles every fix type and pins a note', async () => {
    const id = track(await instantiateTemplate('course-registration'));
    const idx = await applyFix(id, { type: 'ADD_INDEX', table: 'section', columns: ['slot'], name: 'ix_section_slot' });
    expect(idx.design.schema.tables.find((t) => t.name === 'section')!.indexes).toEqual([{ name: 'ix_section_slot', columns: ['slot'], unique: false }]);
    const [[row]] = (await appPool.query('SELECT note FROM design_revision WHERE project_id = ? AND revision_no = ?', [id, idx.revisionNo])) as unknown as [Array<{ note: string }>];
    expect(row!.note).toBe('Advisor: add index on section(slot)');
    // idempotent: same fix again changes nothing, so no new revision
    expect((await applyFix(id, { type: 'ADD_INDEX', table: 'section', columns: ['slot'], name: 'ix_section_slot' })).revisionNo).toBe(idx.revisionNo);

    const apps = (d: DesignDoc) => d.nodes.flatMap((n) => (n.type === 'app' ? [n.config] : []));
    expect(apps((await applyFix(id, { type: 'SET_STRATEGY', strategy: 'atomic' })).design).every((c) => c.strategy === 'atomic')).toBe(true);
    expect(apps((await applyFix(id, { type: 'SET_POOL', poolSize: 8 })).design)[0]!.poolSize).toBe(8);
    expect(apps((await applyFix(id, { type: 'SET_INSTANCES', instances: 3 })).design)[0]!.instances).toBe(3);
    const chk = await applyFix(id, { type: 'ADD_CHECK', table: 'department', expr: '`dept_id` > 0' });
    expect(chk.design.schema.tables.find((t) => t.name === 'department')!.checks.some((c) => c.expr === '`dept_id` > 0')).toBe(true);
    await expect(applyFix(id, { type: 'ADD_INDEX', table: 'nope', columns: ['x'], name: 'ix' })).rejects.toThrow(/Unknown table/);
  });
});

describe('REST', () => {
  it('project CRUD, draft, revisions, duplicate, archive', async () => {
    const c = await request(app).post('/api/projects').send({ name: 'rest test' });
    expect(c.status).toBe(201);
    const id = track(c.body.projectId);
    expect((await request(app).patch(`/api/projects/${id}`).send({ name: 'renamed', description: 'd' })).body).toMatchObject({ name: 'renamed', description: 'd' });

    const d = (await request(app).get(`/api/projects/${id}/draft`)).body.design as DesignDoc;
    d.seed = 5;
    const put = await request(app).put(`/api/projects/${id}/draft`).send(d);
    expect(put.status).toBe(200);
    expect(put.body.updatedAt).toBeTruthy();
    expect((await request(app).put(`/api/projects/${id}/draft`).send({ nodes: 'bad' })).status).toBe(400);

    const pin = await request(app).post(`/api/projects/${id}/revisions`).send({ note: 'v1' });
    expect(pin.body).toEqual({ revisionNo: 1, created: true });
    expect((await request(app).get(`/api/projects/${id}/revisions`)).body).toHaveLength(1);
    expect((await request(app).get(`/api/projects/${id}/revisions/1`)).body.design.seed).toBe(5);
    expect((await request(app).get(`/api/projects/${id}/revisions/7`)).status).toBe(404);

    const fork = await request(app).post(`/api/projects/${id}/duplicate`).send();
    track(fork.body.projectId);
    expect(fork.body.name).toBe('renamed (fork)');
    expect(fork.body.design.seed).toBe(5);

    const list = (await request(app).get('/api/projects')).body as Array<{ projectId: string }>;
    expect(list.some((p) => p.projectId === id)).toBe(true);
    expect((await request(app).post(`/api/projects/${id}/archive`)).status).toBe(200);
    expect(((await request(app).get('/api/projects')).body as Array<{ projectId: string }>).some((p) => p.projectId === id)).toBe(false);
    expect((await request(app).get('/api/projects/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('templates list, instantiate, apply-fix and schema ddl', async () => {
    const list = (await request(app).get('/api/templates')).body as Array<{ key: string }>;
    expect(list.map((t) => t.key)).toEqual(expect.arrayContaining(['course-registration', 'shared-resource']));
    const inst = await request(app).post('/api/templates/course-registration/instantiate').send({});
    expect(inst.status).toBe(201);
    const id = track(inst.body.projectId);
    expect(inst.body.templateKey).toBe('course-registration');
    const fix = await request(app).post(`/api/projects/${id}/apply-fix`).send({ fix: { type: 'ADD_INDEX', table: 'section', columns: ['slot'], name: 'ix_section_slot' } });
    expect(fix.body).toEqual({ revisionNo: 1 });
    expect((await request(app).post('/api/templates/nope/instantiate').send({})).status).toBe(404);

    const ddl = await request(app).post('/api/schema/ddl').send(inst.body.design.schema);
    expect(ddl.body.statements.length).toBe(6);
    expect(ddl.body.sql).toContain('CREATE TABLE `enrollment`');
  });

  it('validate catches a broken design (MySQL-side errors map to tables and steps)', async () => {
    const inst = await request(app).post('/api/templates/course-registration/instantiate').send({});
    const id = track(inst.body.projectId);
    const ok = await request(app).post(`/api/projects/${id}/validate`).send();
    expect(ok.body.errorCount).toBe(0);

    const d = inst.body.design as DesignDoc;
    d.schema.tables.find((t) => t.name === 'student')!.checks.push({ expr: '`nonexistent` > 0' });
    d.workload.transactions[0]!.variants.default![0]!.sql = 'SELECT nope FROM section WHERE section_id = :sid';
    const res = await request(app).post(`/api/projects/${id}/validate`).send({ design: d });
    const codes = (res.body.problems as Array<{ code: string; path: { table?: string } }>);
    expect(codes.some((p) => p.code.startsWith('DDL_') && p.path.table === 'student')).toBe(true);
    expect(res.body.errorCount).toBeGreaterThan(0);

    // fix the DDL, keep the broken SQL: the prepare check catches the unknown column
    d.schema.tables.find((t) => t.name === 'student')!.checks.pop();
    const res2 = await request(app).post(`/api/projects/${id}/validate`).send({ design: d });
    expect((res2.body.problems as Array<{ code: string; path: { txn?: string; step?: number } }>).some((p) => p.code === 'SQL_PREPARE' && p.path.txn === 'register' && p.path.step === 0)).toBe(true);
  });

  it('leaves no scratch schemas behind', async () => {
    const [rows] = await appPool.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?', ['dsim\\_scratch\\_%']);
    expect(rows).toEqual([]);
  });
});

describe('templates', () => {
  it('seeds idempotently as archived master projects', async () => {
    await seedTemplates();
    await seedTemplates();
    for (const t of TEMPLATES) {
      const p = await getProject(templateProjectId(t.key));
      expect(p).toMatchObject({ templateKey: t.key });
      expect(p!.archivedAt).not.toBeNull();
    }
    expect(listTemplates().length).toBe(TEMPLATES.length);
  });

  for (const t of TEMPLATES) {
    it(`${t.key}: zero validation errors and its DDL applies on MySQL`, async () => {
      const design = buildTemplate(t.key);
      expect(validateDesign(design).filter((p) => p.severity === 'error')).toEqual([]);
      expect(hasErrors(validateDesign(design))).toBe(false);
      const problems = await validateDesignFull(templateProjectId(t.key), design);
      expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
      await withScratchSchema('tpl', async (conn) => { expect(await applySchemaDdl(conn, design.schema)).toEqual([]); });
    });
  }
});
