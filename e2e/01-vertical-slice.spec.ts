import { expect, test } from '@playwright/test';
import { API, chooseOption, createProject, latestRun, runAndWait, shorten, shot, waitForIdle, watchConsole } from './helpers';

// Flow 1 (the vertical slice): T1 naive -> violations > 0, atomic -> 0 violations, Compare shows both runs.
test('T1 naive vs atomic with compare', async ({ page, request }) => {
  test.setTimeout(420_000);
  const con = watchConsole(page);
  await waitForIdle(request);
  const projectId = await createProject(request, 'course-registration', (d) => shorten(d, { durationS: 8, vus: 120 }));

  await page.goto(`p/${projectId}`);
  await expect(page.getByTestId('node-users')).toBeVisible();
  await expect(page.getByTestId('node-mysql')).toBeVisible();
  await shot(page, 'studio-t1-idle');

  // naive
  await chooseOption(page, 'Concurrency strategy', /naive/i);
  await runAndWait(page);
  await shot(page, 'studio-t1-naive-finished');
  const naive = await latestRun(request, projectId);
  expect(naive.run.status).toBe('COMPLETED');
  expect(naive.run.strategy).toBe('naive');
  const naiveViolations = naive.invariants.reduce((s, i) => s + i.violations, 0);
  expect(naiveViolations, 'naive strategy must violate an invariant').toBeGreaterThan(0);
  await page.getByRole('tab', { name: /Invariants/ }).click();
  await expect(page.getByText('no_overbooking')).toBeVisible();
  await shot(page, 'studio-t1-naive-invariants');

  // atomic
  await waitForIdle(request);
  await chooseOption(page, 'Concurrency strategy', /atomic/i);
  await runAndWait(page);
  const atomic = await latestRun(request, projectId);
  expect(atomic.run.status).toBe('COMPLETED');
  expect(atomic.run.strategy).toBe('atomic');
  expect(atomic.invariants.reduce((s, i) => s + i.violations, 0)).toBe(0);
  await shot(page, 'studio-t1-atomic-finished');

  // compare both runs
  await page.goto(`compare?ids=${naive.run.runId},${atomic.run.runId}`);
  await expect(page.getByText(/naive/).first()).toBeVisible();
  await expect(page.getByText(/atomic/).first()).toBeVisible();
  await shot(page, 'compare-naive-vs-atomic');

  // the run report loads
  await page.goto(`runs/${naive.run.runId}`);
  await expect(page.getByText('no_overbooking').first()).toBeVisible();
  await shot(page, 'report-naive');
  void API;
  con.assertClean();
});
