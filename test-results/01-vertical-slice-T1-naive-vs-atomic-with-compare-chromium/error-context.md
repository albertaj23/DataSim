# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 01-vertical-slice.spec.ts >> T1 naive vs atomic with compare
- Location: e2e\01-vertical-slice.spec.ts:5:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/naive/).first()
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText(/naive/).first() with timeout 15000ms
  - waiting for getByText(/naive/).first()

```

```yaml
- navigation "Main":
  - link "DataSim home":
    - /url: /DataSim/
  - link "Projects":
    - /url: /DataSim/
  - link "Runs":
    - /url: /DataSim/runs
  - link "Concurrency Lab":
    - /url: /DataSim/lab
  - link "Transaction Stepper":
    - /url: /DataSim/stepper
  - button "How measurements work"
  - button "Settings"
  - 'button "Health: All systems ok"'
- main:
  - heading "Compare" [level=1]
  - text: Compare Side-by-side metrics and design diff for selected runs.
- region "Notifications"
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | import { API, chooseOption, createProject, latestRun, runAndWait, shorten, shot, waitForIdle, watchConsole } from './helpers';
  3  | 
  4  | // Flow 1 (the vertical slice): T1 naive -> violations > 0, atomic -> 0 violations, Compare shows both runs.
  5  | test('T1 naive vs atomic with compare', async ({ page, request }) => {
  6  |   test.setTimeout(420_000);
  7  |   const con = watchConsole(page);
  8  |   await waitForIdle(request);
  9  |   const projectId = await createProject(request, 'course-registration', (d) => shorten(d, { durationS: 8, vus: 120 }));
  10 | 
  11 |   await page.goto(`p/${projectId}`);
  12 |   await expect(page.getByTestId('node-users')).toBeVisible();
  13 |   await expect(page.getByTestId('node-mysql')).toBeVisible();
  14 |   await shot(page, 'studio-t1-idle');
  15 | 
  16 |   // naive
  17 |   await chooseOption(page, 'Concurrency strategy', /naive/i);
  18 |   await runAndWait(page);
  19 |   await shot(page, 'studio-t1-naive-finished');
  20 |   const naive = await latestRun(request, projectId);
  21 |   expect(naive.run.status).toBe('COMPLETED');
  22 |   expect(naive.run.strategy).toBe('naive');
  23 |   const naiveViolations = naive.invariants.reduce((s, i) => s + i.violations, 0);
  24 |   expect(naiveViolations, 'naive strategy must violate an invariant').toBeGreaterThan(0);
  25 |   await page.getByRole('tab', { name: /Invariants/ }).click();
  26 |   await expect(page.getByText('no_overbooking')).toBeVisible();
  27 |   await shot(page, 'studio-t1-naive-invariants');
  28 | 
  29 |   // atomic
  30 |   await waitForIdle(request);
  31 |   await chooseOption(page, 'Concurrency strategy', /atomic/i);
  32 |   await runAndWait(page);
  33 |   const atomic = await latestRun(request, projectId);
  34 |   expect(atomic.run.status).toBe('COMPLETED');
  35 |   expect(atomic.run.strategy).toBe('atomic');
  36 |   expect(atomic.invariants.reduce((s, i) => s + i.violations, 0)).toBe(0);
  37 |   await shot(page, 'studio-t1-atomic-finished');
  38 | 
  39 |   // compare both runs
  40 |   await page.goto(`compare?ids=${naive.run.runId},${atomic.run.runId}`);
> 41 |   await expect(page.getByText(/naive/).first()).toBeVisible();
     |                                                 ^ Error: expect(locator).toBeVisible() failed
  42 |   await expect(page.getByText(/atomic/).first()).toBeVisible();
  43 |   await shot(page, 'compare-naive-vs-atomic');
  44 | 
  45 |   // the run report loads
  46 |   await page.goto(`runs/${naive.run.runId}`);
  47 |   await expect(page.getByText('no_overbooking').first()).toBeVisible();
  48 |   await shot(page, 'report-naive');
  49 |   void API;
  50 |   con.assertClean();
  51 | });
  52 | 
```