import { expect, test } from '@playwright/test';
import { createProject, latestRun, shorten, shot, waitForIdle, watchConsole } from './helpers';

// Flow 4: Run > Capacity test (small steps) completes and the report shows the capacity table and the USL curve.
test('capacity test shows steps and the USL curve', async ({ page, request }) => {
  test.setTimeout(300_000);
  const con = watchConsole(page);
  await waitForIdle(request);
  const projectId = await createProject(request, 'course-registration', (d) => {
    shorten(d, { durationS: 4, vus: 20 });
    d.capacity = { steps: [5, 15, 40, 80], stepDurationS: 4 };
  });

  await page.goto(`p/${projectId}`);
  await expect(page.getByTestId('node-users')).toBeVisible();
  await page.getByRole('button', { name: 'Run options' }).click();
  await page.getByRole('menuitem', { name: /Capacity test/ }).click();
  await expect(page.getByTestId('stop-run')).toBeVisible({ timeout: 30_000 });
  await shot(page, 'studio-capacity-running');
  await expect(page.getByTestId('stop-run')).toBeHidden({ timeout: 200_000 });
  await shot(page, 'studio-capacity-finished');

  const run = await latestRun(request, projectId);
  expect(run.run.kind).toBe('CAPACITY');
  expect(run.run.status).toBe('COMPLETED');

  await page.goto(`runs/${run.run.runId}`);
  await expect(page.getByTestId('report')).toBeVisible();
  await expect(page.getByTestId('capacity-sentence')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('capacity-row')).toHaveCount(4);
  await expect(page.getByText('PROJECTED').first()).toBeVisible();
  await page.getByTestId('capacity-sentence').scrollIntoViewIfNeeded();
  await shot(page, 'report-capacity');

  con.assertClean();
});
