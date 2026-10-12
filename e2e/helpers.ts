import { expect, type APIRequestContext, type ConsoleMessage, type Page } from '@playwright/test';
import type { DesignDoc, ProjectDetail, RunReport } from '@datasim/shared';
import path from 'node:path';

export const API = 'http://127.0.0.1:4000/api';
export const SCREENS = path.resolve(__dirname, '..', '.datasim-v2', 'screens');

/** Collects console errors / page errors; call `assertClean()` at the end of a flow. */
export function watchConsole(page: Page) {
  const errors: string[] = [];
  const ignore = [/attribution/i, /Download the React DevTools/i];
  page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error' && !ignore.some((r) => r.test(m.text()))) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return { errors, assertClean: () => expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]) };
}

export const shot = async (page: Page, name: string) => { await page.screenshot({ path: path.join(SCREENS, `${name}.png`) }); };

/** Waits until no run holds the global lock (other suites/builders may be running). */
export async function waitForIdle(request: APIRequestContext, timeoutMs = 240_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await request.get(`${API}/health`);
    const h = await r.json();
    if (!h.activeRunId) return;
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error('a run is still active');
}

/** Instantiates a template and shortens it for e2e (short duration, fewer VUs). Returns the project id. */
export async function createProject(request: APIRequestContext, templateKey: string, tune: (d: DesignDoc) => void = () => {}): Promise<string> {
  const inst = await request.post(`${API}/templates/${templateKey}/instantiate`, { data: {} });
  expect(inst.ok()).toBeTruthy();
  const project = (await inst.json()) as ProjectDetail;
  const draftRes = await request.get(`${API}/projects/${project.projectId}/draft`);
  const draftBody = await draftRes.json();
  const design: DesignDoc = draftBody.design ?? draftBody;
  tune(design);
  const put = await request.put(`${API}/projects/${project.projectId}/draft`, { data: { design } });
  expect(put.ok(), await put.text()).toBeTruthy();
  return project.projectId;
}

export function shorten(d: DesignDoc, opts: { durationS?: number; vus?: number; warmupS?: number } = {}) {
  for (const n of d.nodes) {
    if (n.type === 'users') {
      n.config.durationS = opts.durationS ?? 8;
      n.config.warmupS = opts.warmupS ?? 1;
      n.config.vus = opts.vus ?? 80;
    }
  }
}

export async function latestRun(request: APIRequestContext, projectId: string): Promise<RunReport> {
  const list = await (await request.get(`${API}/runs?projectId=${projectId}`)).json();
  const id = list[0].runId as string;
  return (await (await request.get(`${API}/runs/${id}`)).json()) as RunReport;
}

/** Choose an option in a Radix select identified by its aria-label. */
export async function chooseOption(page: Page, ariaLabel: string, optionName: string | RegExp) {
  await page.getByRole('combobox', { name: ariaLabel }).click();
  await page.getByRole('option', { name: optionName }).click();
}

/** Click Run, wait for the verdict to appear in the Live tab (run finished). */
export async function runAndWait(page: Page, timeoutMs = 150_000) {
  const before = await page.getByTestId('verdict').count();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('stop-run')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('stop-run')).toBeHidden({ timeout: timeoutMs });
  await expect(page.getByTestId('verdict')).toHaveCount(Math.max(before, 1), { timeout: 30_000 });
}
