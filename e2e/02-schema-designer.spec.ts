import { expect, test } from '@playwright/test';
import { API, shot, waitForIdle, watchConsole } from './helpers';

// Flow 2: blank project -> nodes -> Schema Designer: add a table, a column and an FK -> DDL tab -> provision.
test('schema designer: table, column, FK, DDL, provision', async ({ page, request }) => {
  test.setTimeout(180_000);
  const con = watchConsole(page);
  await waitForIdle(request);

  // New project > Blank design via the Projects page.
  await page.goto('');
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await shot(page, 'projects-page');
  await page.getByRole('button', { name: 'New project options' }).click();
  await page.getByRole('menuitem', { name: 'Blank design' }).click();
  await page.waitForURL(/\/p\/[^/]+$/);
  const projectId = page.url().split('/p/')[1]!;
  await shot(page, 'studio-blank');

  // Give the blank design users -> app -> mysql (the draft is the source of truth; reload picks it up).
  const draft = await (await request.get(`${API}/projects/${projectId}/draft`)).json();
  const design = draft.design ?? draft;
  const pos = (x: number) => ({ x, y: 120 });
  design.nodes = [
    { id: 'u', type: 'users', name: 'Users', position: pos(0), config: { vus: 5, durationS: 3, warmupS: 0 } },
    { id: 'a', type: 'app', name: 'App', position: pos(300), config: {} },
    { id: 'm', type: 'mysql', name: 'MySQL', position: pos(600), config: {} },
  ];
  design.edges = [{ id: 'e1', source: 'u', target: 'a' }, { id: 'e2', source: 'a', target: 'm' }];
  const put = await request.put(`${API}/projects/${projectId}/draft`, { data: { design } });
  expect(put.ok(), await put.text()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId('node-mysql')).toBeVisible();
  await shot(page, 'studio-blank-with-nodes');

  // Open the Schema Designer from the database node.
  await page.getByTestId('node-mysql').dblclick();
  const inspector = page.getByLabel('Schema inspector');
  await expect(inspector).toBeVisible();
  await expect(page.getByText('No tables yet')).toBeVisible();
  await shot(page, 'schema-empty');

  // Two tables: new_table (parent) and new_table_2 (child).
  await page.getByRole('button', { name: 'Add table', exact: true }).first().click();
  await expect(inspector.getByLabel('Table name')).toHaveValue('new_table');
  await inspector.getByLabel('Table name').fill('authors');
  await inspector.getByLabel('Table name').press('Enter');
  await page.getByRole('button', { name: 'Add table', exact: true }).click();
  await inspector.getByLabel('Table name').fill('books');
  await inspector.getByLabel('Table name').press('Enter');
  await shot(page, 'schema-two-tables');
  // (renaming the selected table clears the selection: product quirk, reported) select books on the canvas again.
  await page.locator('.react-flow__node').filter({ hasText: 'books' }).click();

  // A column on books, then an FK books.column -> authors.id.
  await inspector.getByRole('button', { name: 'Add column' }).click();
  await expect(inspector.getByLabel('Column name column')).toBeVisible();
  await inspector.getByLabel('Column name column').fill('author_id');
  await inspector.getByLabel('Column name column').press('Enter');
  await expect(inspector.getByLabel('Column name author_id')).toBeVisible();
  await inspector.getByLabel('Type of author_id').click();
  await page.getByRole('option', { name: 'INT', exact: true }).click();
  await inspector.getByRole('button', { name: 'Add foreign key' }).click();
  // the new FK defaults to the first non-key column (author_id) -> the other table's key
  await expect(inspector.getByLabel('Foreign key columns')).toContainText('author_id');
  await expect(inspector.getByLabel('Referenced table')).toContainText('authors');
  await shot(page, 'schema-fk');

  // DDL tab shows CREATE TABLE and the FK.
  await inspector.getByRole('tab', { name: 'DDL' }).click();
  await expect(inspector.getByText('CREATE TABLE').first()).toBeVisible();
  const ddl = await inspector.textContent();
  expect(ddl).toMatch(/CREATE TABLE\s+`?authors`?/);
  expect(ddl).toMatch(/CREATE TABLE\s+`?books`?/);
  expect(ddl).toMatch(/FOREIGN KEY\s*\(`?author_id`?\)\s*REFERENCES\s+`?authors`?\s*\(`?id`?\)/);
  await shot(page, 'schema-ddl');

  // Provision the sandbox.
  await page.getByRole('button', { name: 'Provision sandbox' }).click();
  await expect(page.getByText(/Provisioning ok · 2 tables/).first()).toBeVisible({ timeout: 90_000 });
  await shot(page, 'schema-provisioned');

  con.assertClean();
});
