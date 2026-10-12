import { expect, test } from '@playwright/test';
import type { RunReport } from '@datasim/shared';
import { API, createProject, latestRun, runAndWait, shorten, shot, waitForIdle, watchConsole } from './helpers';

const stat = (r: RunReport) => r.statementStats.find((s) => s.txnName === 'search_sections' || /search_sections/i.test(s.digestText) || /STRAIGHT_JOIN/i.test(s.digestText));

// Flow 5: findings -> apply the FULL_SCAN index fix -> new revision -> re-run: no FULL_SCAN, fewer rows examined.
test('index advisor: apply fix and re-run', async ({ page, request }) => {
  test.setTimeout(420_000);
  const con = watchConsole(page);
  await waitForIdle(request);
  const projectId = await createProject(request, 'course-registration', (d) => {
    shorten(d, { durationS: 10, vus: 80 });
    for (const n of d.nodes) if (n.type === 'app') n.config.strategy = 'atomic';
  });

  await page.goto(`p/${projectId}`);
  await expect(page.getByTestId('node-users')).toBeVisible();
  await runAndWait(page);
  const first = await latestRun(request, projectId);
  expect(first.run.status).toBe('COMPLETED');

  await page.goto(`runs/${first.run.runId}`);
  await expect(page.getByTestId('report')).toBeVisible();
  const finding = page.locator('[data-testid^="finding-"][data-kind="FULL_SCAN"]').filter({ hasText: /sections/ }).first();
  await expect(finding).toBeVisible({ timeout: 30_000 });
  await finding.scrollIntoViewIfNeeded();
  await shot(page, 'report-findings-full-scan');

  const revBefore = (await (await request.get(`${API}/projects/${projectId}`)).json()).latestRevisionNo ?? null;
  await finding.getByRole('button', { name: 'Apply fix' }).click();
  await expect(finding.getByText(/Applied · rev \d+/)).toBeVisible({ timeout: 30_000 });
  const rev = Number((await finding.getByText(/Applied · rev \d+/).textContent())!.match(/rev (\d+)/)![1]);
  expect(rev).toBeGreaterThan(Number(first.run.revisionNo));
  if (revBefore !== null) expect(rev).toBeGreaterThan(Number(revBefore) - 1);
  await shot(page, 'report-fix-applied');

  // re-run from the finding card; it navigates to the new run's live view
  await waitForIdle(request);
  await finding.getByRole('button', { name: 'Re-run' }).click();
  await page.waitForURL((u) => /\/runs\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith(first.run.runId), { timeout: 30_000 });
  // the old report stays mounted while the new run loads, so poll the API for the finished new run
  await expect.poll(async () => { const r = await latestRun(request, projectId); return r.run.runId !== first.run.runId && r.run.status === 'COMPLETED'; }, { timeout: 200_000, intervals: [2000] }).toBe(true);
  await expect(page.getByTestId('report')).toHaveAttribute('data-run-status', 'COMPLETED');
  await expect(page).toHaveURL(new RegExp(`/runs/(?!${first.run.runId})`));
  await shot(page, 'report-after-index');
  const second = await latestRun(request, projectId);
  expect(second.run.runId).not.toBe(first.run.runId);
  expect(second.run.revisionNo).toBe(rev);
  expect(second.findings.some((f) => f.kind === 'FULL_SCAN' && /sections/.test(JSON.stringify(f.evidence) + f.title)), 'FULL_SCAN on sections must be gone').toBeFalsy();
  const a = stat(first)!;
  const b = stat(second)!;
  expect(a, 'search statement in run 1').toBeTruthy();
  expect(b, 'search statement in run 2').toBeTruthy();
  console.log('search stat before/after', a.avgMs, a.rowsExamined, '->', b.avgMs, b.rowsExamined);
  expect(b.rowsExamined, 'rows examined must drop').toBeLessThan(a.rowsExamined);
  expect(b.avgMs, 'avg ms must not get worse by more than 20%').toBeLessThanOrEqual(a.avgMs * 1.2);

  con.assertClean();
});
