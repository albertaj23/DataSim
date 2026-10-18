import { expect, test } from '@playwright/test';
import { API, chooseOption, shot, waitForIdle, watchConsole } from './helpers';

// Flow 6: Concurrency Lab (tabs + one small NAIVE experiment) and the Transaction Stepper (classic deadlock).
test('lab: tabs and a small NAIVE experiment', async ({ page, request }) => {
  test.setTimeout(180_000);
  const con = watchConsole(page);
  await waitForIdle(request);
  // Open stepper transactions hold row locks that block Lab runs: make sure none is left over.
  await request.post(`${API}/lab/stepper/reset`, { data: {} });

  await page.goto('lab');
  await expect(page.getByRole('heading', { name: 'Concurrency Lab' })).toBeVisible();
  await shot(page, 'lab-strategy-idle');

  // only NAIVE, small and fast: 3 trials of 20 clients on one account
  for (const s of ['TXN_RR', 'SERIALIZABLE', 'PESSIMISTIC', 'OPTIMISTIC', 'CONSTRAINT', 'TRIGGER', 'REDIS_LEASE']) {
    const chip = page.getByRole('button', { name: s, exact: true });
    if ((await chip.isEnabled()) && (await chip.getAttribute('aria-pressed')) === 'true') await chip.click();
  }
  const trials = page.getByRole('textbox', { name: 'Trials' });
  await trials.fill('3');
  await trials.press('Enter');
  await page.getByRole('textbox', { name: 'Concurrency' }).fill('20');
  await page.getByRole('textbox', { name: 'Concurrency' }).press('Enter');
  await page.getByRole('button', { name: 'Run 1 strategy' }).click();

  const table = page.getByRole('table', { name: 'Experiment results' });
  await expect(table).toBeVisible({ timeout: 120_000 });
  const row = table.getByRole('row', { name: /NAIVE/ });
  await expect(row).toBeVisible();
  // columns: Strategy, Isolation, Trials, Violations
  const violations = Number((await row.getByRole('cell').nth(3).textContent())!.replace(/[^0-9]/g, ''));
  expect(violations, 'NAIVE must violate the stream limit').toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Run 1 strategy' })).toBeVisible({ timeout: 30_000 });
  await shot(page, 'lab-strategy-results');

  // tabs deep-link
  await page.goto('lab?tab=index');
  await expect(page.getByRole('tab', { name: 'Index experiment' })).toHaveAttribute('data-state', 'active');
  await shot(page, 'lab-index-tab');
  await page.goto('lab?tab=history');
  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByText('Experiment history')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Experiment runs per strategy' })).toBeVisible();
  await shot(page, 'lab-history-tab');

  con.assertClean();
});

test('stepper: classic deadlock', async ({ page, request }) => {
  test.setTimeout(120_000);
  const con = watchConsole(page);
  await waitForIdle(request);
  await request.post(`${API}/lab/stepper/reset`, { data: {} });

  await page.goto('stepper?scenario=CLASSIC_DEADLOCK');
  await expect(page.getByRole('heading', { name: 'Transaction Stepper' })).toBeVisible();
  // the server-side loaded scenario wins over ?scenario=, so pick explicitly
  await chooseOption(page, 'Scenario', /Classic deadlock/);
  await shot(page, 'stepper-idle');
  await page.getByRole('button', { name: /^(Re)?load scenario/i }).click();
  await expect(page.getByRole('region', { name: 'Transaction T1' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Run T1/ })).toBeEnabled();
  await shot(page, 'stepper-loaded');

  // step through the suggested order with "Run next" until InnoDB reports the deadlock
  const alert = page.getByRole('alert').filter({ hasText: 'Deadlock detected' });
  for (let i = 0; i < 8 && !(await alert.isVisible()); i++) {
    const next = page.getByRole('button', { name: /^Run (T1|T2)/ }).first();
    await expect(next).toBeEnabled({ timeout: 20_000 });
    await next.click();
    if (i === 2) await shot(page, 'stepper-mid');
    await page.waitForTimeout(400);
  }
  await expect(alert).toBeVisible({ timeout: 20_000 });
  await expect(alert).toContainText('errno 1213');
  await shot(page, 'stepper-deadlock');

  // leaving the page resets open transactions (G); also reset via the API so later specs are not blocked
  await page.goto('');
  await request.post(`${API}/lab/stepper/reset`, { data: {} });
  con.assertClean();
});
