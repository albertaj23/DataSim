import { expect, test } from '@playwright/test';
import { API, createProject, shorten, shot, waitForIdle, watchConsole } from './helpers';

// Flow 3: Workload Editor on T1: Test once on `register` shows per-step results; Explain on a SELECT step.
test('workload editor: test once and explain', async ({ page, request }) => {
  test.setTimeout(240_000);
  const con = watchConsole(page);
  await waitForIdle(request);
  const projectId = await createProject(request, 'course-registration', (d) => shorten(d, { durationS: 4, vus: 20 }));
  // Provision up front through the API: "Test once" before provisioning is an expected 4xx (NOT_PROVISIONED), which the browser logs as a console error.
  const prov = await request.post(`${API}/projects/${projectId}/sandbox/provision`, { data: {}, timeout: 180_000 });
  expect(prov.ok(), await prov.text()).toBeTruthy();

  await page.goto(`p/${projectId}`);
  await expect(page.getByTestId('node-users')).toBeVisible();
  await page.getByTestId('node-users').dblclick();
  await expect(page.getByRole('heading', { name: 'Workload editor' })).toBeVisible();
  const list = page.getByRole('button', { name: /^register/ });
  await expect(list.first()).toBeVisible();
  await list.first().click();
  await shot(page, 'workload-register');

  // Test once for `register` (default variant)
  const panel = page.getByLabel('Test once', { exact: true });
  await panel.getByRole('button', { name: 'Test once' }).click();
  await expect(panel.getByText('Result', { exact: true })).toBeVisible({ timeout: 60_000 });
  const steps = panel.locator('ol > li');
  expect(await steps.count()).toBeGreaterThan(0);
  // every step reports a latency and rows/affected
  for (let i = 0; i < (await steps.count()); i++) {
    const t = await steps.nth(i).textContent();
    expect(t).toMatch(/\d+(\.\d+)?\s*(ms|s|µs|us)/);
    expect(t).toMatch(/\d+ (affected|rows?)/);
  }
  await expect(panel.getByText(/Executed, rolled back|Rejected/)).toBeVisible();
  await shot(page, 'workload-test-once');

  // Explain on a SELECT step (if the transaction has one)
  const explain = page.getByRole('button', { name: 'Explain' }).first();
  if (await explain.count()) {
    await explain.click();
    await expect(page.getByText('EXPLAIN', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await shot(page, 'workload-explain');
  }

  // Invariants tab renders
  await page.getByRole('tab', { name: /Invariants/ }).click();
  await expect(page.getByText('no_overbooking').first()).toBeVisible();
  await shot(page, 'workload-invariants');

  con.assertClean();
});
