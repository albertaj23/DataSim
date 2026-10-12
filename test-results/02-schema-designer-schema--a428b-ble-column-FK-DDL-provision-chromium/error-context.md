# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 02-schema-designer.spec.ts >> schema designer: table, column, FK, DDL, provision
- Location: e2e\02-schema-designer.spec.ts:5:5

# Error details

```
Test timeout of 180000ms exceeded.
```

```
Error: locator.click: Test timeout of 180000ms exceeded.
Call log:
  - waiting for getByLabel('Schema inspector').getByRole('button', { name: 'Add column' })

```

# Page snapshot

```yaml
- generic:
  - generic:
    - generic:
      - navigation [aria-hidden]:
        - link:
          - /url: /DataSim/
        - generic:
          - link:
            - /url: /DataSim/
          - link:
            - /url: /DataSim/runs
          - link:
            - /url: /DataSim/lab
          - link:
            - /url: /DataSim/stepper
        - generic:
          - button
          - button
          - button
          - button
      - main:
        - generic:
          - generic [aria-hidden]:
            - generic:
              - navigation:
                - link:
                  - /url: /DataSim/
                  - text: Projects
                - generic: /
                - button: Untitled design
              - button:
                - generic: no revision · draft saved
              - button
            - generic:
              - button:
                - text: Validate
                - generic: "1"
              - generic:
                - generic:
                  - generic: Strategy
                  - combobox:
                    - generic: default
                - generic:
                  - generic: Isolation
                  - combobox:
                    - generic: REPEATABLE READ
              - button:
                - generic: p95 ≤ 200 ms · err ≤ 1%
              - generic:
                - button: Run
                - button
              - button
          - generic:
            - complementary [aria-hidden]:
              - generic:
                - generic:
                  - textbox:
                    - /placeholder: Search components
              - generic:
                - generic:
                  - heading [level=3]: Traffic
                  - generic:
                    - generic:
                      - button [disabled]:
                        - generic:
                          - generic: Users
                          - generic: Virtual users and workload
                        - generic: 1/1
                    - button:
                      - generic:
                        - generic: Load balancer
                        - generic: Spreads traffic over apps
                      - generic: 0/1
                - generic:
                  - heading [level=3]: Compute
                  - generic:
                    - button:
                      - generic:
                        - generic: App server
                        - generic: Workers, pool and retries
                      - generic: 1/4
                - generic:
                  - heading [level=3]: Data
                  - generic:
                    - button:
                      - generic:
                        - generic: Cache
                        - generic: Redis cache-aside reads
                      - generic: 0/1
                    - generic:
                      - button [disabled]:
                        - generic:
                          - generic: Database
                          - generic: MySQL 8.4 · InnoDB
                        - generic: 1/1
              - paragraph: Drag onto the canvas or click to add. Connect with the handles on a node’s edges.
            - generic:
              - generic:
                - application:
                  - generic [aria-hidden]:
                    - generic:
                      - generic:
                        - generic:
                          - button [ref=f1e1]:
                            - generic [ref=f1e2]: 1 ms
                          - button [ref=f1e4]:
                            - generic [ref=f1e5]: 1 ms
                        - generic:
                          - group [ref=f1e7]:
                            - generic [ref=f1e8]:
                              - generic [ref=f1e10]:
                                - generic [ref=f1e11]: users
                                - generic [ref=f1e18]:
                                  - generic [ref=f1e19]:
                                    - generic [ref=f1e20]: Users
                                    - button [ref=f1e21]
                                  - generic [ref=f1e26]: constant · 3s
                              - generic: 5 VUs
                          - group [ref=f1e32]:
                            - generic [ref=f1e33]:
                              - generic [ref=f1e36]:
                                - generic [ref=f1e37]: app
                                - generic [ref=f1e42]:
                                  - generic [ref=f1e43]:
                                    - generic [ref=f1e44]: App
                                    - button [ref=f1e45]
                                  - generic [ref=f1e50]: strategy default
                              - generic: 1× pool 16
                          - group [ref=f1e56]:
                            - generic [ref=f1e57]:
                              - generic [ref=f1e59]:
                                - generic [ref=f1e60]: mysql
                                - generic [ref=f1e66]:
                                  - generic [ref=f1e67]:
                                    - generic [ref=f1e68]: MySQL
                                    - button [ref=f1e69]
                                  - generic [ref=f1e74]: MySQL 8.4 · InnoDB
                              - generic:
                                - generic: RR
                                - generic: lwt 3s
                  - generic [aria-hidden]:
                    - button
                    - button
                    - button
                  - generic [aria-hidden]:
                    - button
                    - button [disabled]
                    - button
            - complementary [aria-hidden]:
              - generic:
                - generic:
                  - generic: Database
                  - generic: m
                - textbox: MySQL
              - generic:
                - generic:
                  - heading [level=3]: Engine
                - generic:
                  - generic: Engine
                  - generic: MySQL 8.4 · InnoDB
                - generic:
                  - generic: Isolation
                  - generic:
                    - combobox:
                      - generic: REPEATABLE READ
                - generic:
                  - generic: Lock wait
                  - generic:
                    - generic:
                      - textbox: "3"
                      - generic: s
                - generic:
                  - generic: Max exec time
                  - generic:
                    - generic:
                      - textbox: "0"
                      - generic: ms
                  - generic: 0 = unlimited
              - generic:
                - generic:
                  - heading [level=3]: Schema
                - generic:
                  - generic:
                    - term: Tables
                    - definition: "2"
                  - generic:
                    - term: Seed rows
                    - definition: "200"
                  - generic:
                    - term: Indexes
                    - definition: "0"
                - button: Open schema designer
              - generic:
                - button:
                  - heading [level=3]: Which database fits?
              - generic:
                - button: Delete node
          - region [aria-hidden]:
            - separator
            - generic:
              - generic:
                - tablist:
                  - tab [selected]: Live
                  - tab: Transactions
                  - tab: Statements
                  - tab: Locks
                  - tab: Invariants
                  - tab: Findings
                  - tab: Log
                - generic:
                  - button
              - generic:
                - tabpanel:
                  - generic:
                    - generic:
                      - generic:
                        - generic: No run yet
                        - generic: Run the design to stream throughput, latency, errors and database load here.
                      - generic:
                        - button: Run load test
  - dialog [active] [ref=f1e80]:
    - banner [ref=f1e81]:
      - heading "Schema designer" [level=2] [ref=f1e82]
      - paragraph [ref=f1e83]: Schema designer
      - generic [ref=f1e84]:
        - generic [ref=f1e85]: Esc
        - button "Close" [ref=f1e86]
    - generic [ref=f1e91]:
      - generic [ref=f1e92]:
        - button "Add table" [ref=f1e93]
        - button "Auto layout" [ref=f1e95]
        - button "Seed data" [ref=f1e101]
        - button "Import DDL" [ref=f1e106]
        - button "Normalize" [ref=f1e111]
        - button "DDL" [ref=f1e118]
        - button "Validate" [ref=f1e124]
        - button "Provision sandbox" [ref=f1e129]
      - generic [ref=f1e132]:
        - application [ref=f1e135]:
          - generic [ref=f1e137]:
            - generic:
              - generic:
                - group [ref=f1e138]:
                  - generic [ref=f1e139]:
                    - generic [ref=f1e140]:
                      - generic "authors" [ref=f1e143]
                      - generic "Seed rows" [ref=f1e144]: "100"
                    - generic [ref=f1e146]:
                      - img "Primary key" [ref=f1e149]
                      - generic "id" [ref=f1e152]
                      - generic "INT" [ref=f1e153]
                - group [ref=f1e155]:
                  - generic [ref=f1e156]:
                    - generic [ref=f1e157]:
                      - generic "books" [ref=f1e160]
                      - generic "Seed rows" [ref=f1e161]: "100"
                    - generic [ref=f1e163]:
                      - img "Primary key" [ref=f1e166]
                      - generic "id" [ref=f1e169]
                      - generic "INT" [ref=f1e170]
          - generic "Control Panel" [ref=f1e172]:
            - button "Zoom In" [ref=f1e173] [cursor=pointer]
            - button "Zoom Out" [ref=f1e176] [cursor=pointer]
            - button "Fit View" [ref=f1e179] [cursor=pointer]
          - img "Mini Map" [ref=f1e183]
        - complementary "Schema inspector" [ref=f1e187]:
          - generic [ref=f1e188]:
            - tablist [ref=f1e189]:
              - tab "Table" [selected] [ref=f1e190]
              - tab "DDL" [ref=f1e191]
              - tab "Query" [ref=f1e192]
              - tab "Problems" [ref=f1e193]
            - tabpanel "Table" [ref=f1e194]:
              - generic [ref=f1e197]:
                - generic [ref=f1e198]: No table selected
                - generic [ref=f1e199]: Select a table on the canvas to edit its columns, keys, constraints and seed generators.
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | import { API, shot, waitForIdle, watchConsole } from './helpers';
  3  | 
  4  | // Flow 2: blank project -> nodes -> Schema Designer: add a table, a column and an FK -> DDL tab -> provision.
  5  | test('schema designer: table, column, FK, DDL, provision', async ({ page, request }) => {
  6  |   test.setTimeout(180_000);
  7  |   const con = watchConsole(page);
  8  |   await waitForIdle(request);
  9  | 
  10 |   // New project > Blank design via the Projects page.
  11 |   await page.goto('');
  12 |   await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  13 |   await shot(page, 'projects-page');
  14 |   await page.getByRole('button', { name: 'New project options' }).click();
  15 |   await page.getByRole('menuitem', { name: 'Blank design' }).click();
  16 |   await page.waitForURL(/\/p\/[^/]+$/);
  17 |   const projectId = page.url().split('/p/')[1]!;
  18 |   await shot(page, 'studio-blank');
  19 | 
  20 |   // Give the blank design users -> app -> mysql (the draft is the source of truth; reload picks it up).
  21 |   const draft = await (await request.get(`${API}/projects/${projectId}/draft`)).json();
  22 |   const design = draft.design ?? draft;
  23 |   const pos = (x: number) => ({ x, y: 120 });
  24 |   design.nodes = [
  25 |     { id: 'u', type: 'users', name: 'Users', position: pos(0), config: { vus: 5, durationS: 3, warmupS: 0 } },
  26 |     { id: 'a', type: 'app', name: 'App', position: pos(300), config: {} },
  27 |     { id: 'm', type: 'mysql', name: 'MySQL', position: pos(600), config: {} },
  28 |   ];
  29 |   design.edges = [{ id: 'e1', source: 'u', target: 'a' }, { id: 'e2', source: 'a', target: 'm' }];
  30 |   const put = await request.put(`${API}/projects/${projectId}/draft`, { data: { design } });
  31 |   expect(put.ok(), await put.text()).toBeTruthy();
  32 |   await page.reload();
  33 |   await expect(page.getByTestId('node-mysql')).toBeVisible();
  34 |   await shot(page, 'studio-blank-with-nodes');
  35 | 
  36 |   // Open the Schema Designer from the database node.
  37 |   await page.getByTestId('node-mysql').dblclick();
  38 |   const inspector = page.getByLabel('Schema inspector');
  39 |   await expect(inspector).toBeVisible();
  40 |   await expect(page.getByText('No tables yet')).toBeVisible();
  41 |   await shot(page, 'schema-empty');
  42 | 
  43 |   // Two tables: new_table (parent) and new_table_2 (child).
  44 |   await page.getByRole('button', { name: 'Add table', exact: true }).first().click();
  45 |   await expect(inspector.getByLabel('Table name')).toHaveValue('new_table');
  46 |   await inspector.getByLabel('Table name').fill('authors');
  47 |   await inspector.getByLabel('Table name').press('Enter');
  48 |   await page.getByRole('button', { name: 'Add table', exact: true }).click();
  49 |   await inspector.getByLabel('Table name').fill('books');
  50 |   await inspector.getByLabel('Table name').press('Enter');
  51 |   await shot(page, 'schema-two-tables');
  52 | 
  53 |   // A column on books, then an FK books.column -> authors.id.
> 54 |   await inspector.getByRole('button', { name: 'Add column' }).click();
     |                                                               ^ Error: locator.click: Test timeout of 180000ms exceeded.
  55 |   await expect(inspector.getByLabel('Column name column')).toBeVisible();
  56 |   await inspector.getByLabel('Column name column').fill('author_id');
  57 |   await inspector.getByLabel('Column name column').press('Enter');
  58 |   await expect(inspector.getByLabel('Column name author_id')).toBeVisible();
  59 |   await inspector.getByLabel('Type of author_id').click();
  60 |   await page.getByRole('option', { name: 'INT', exact: true }).click();
  61 |   await inspector.getByRole('button', { name: 'Add foreign key' }).click();
  62 |   await inspector.getByLabel('Foreign key columns').click();
  63 |   await page.getByRole('button', { name: 'author_id' }).click();
  64 |   await page.keyboard.press('Escape');
  65 |   await expect(inspector.getByLabel('Foreign key columns')).toContainText('author_id');
  66 |   await expect(inspector.getByLabel('Referenced table')).toContainText('authors');
  67 |   await shot(page, 'schema-fk');
  68 | 
  69 |   // DDL tab shows CREATE TABLE and the FK.
  70 |   await inspector.getByRole('tab', { name: 'DDL' }).click();
  71 |   await expect(inspector.getByText('CREATE TABLE').first()).toBeVisible();
  72 |   const ddl = await inspector.textContent();
  73 |   expect(ddl).toMatch(/CREATE TABLE\s+`?authors`?/);
  74 |   expect(ddl).toMatch(/CREATE TABLE\s+`?books`?/);
  75 |   expect(ddl).toMatch(/FOREIGN KEY\s*\(`?author_id`?\)\s*REFERENCES\s+`?authors`?\s*\(`?id`?\)/);
  76 |   await shot(page, 'schema-ddl');
  77 | 
  78 |   // Provision the sandbox.
  79 |   await page.getByRole('button', { name: 'Provision sandbox' }).click();
  80 |   await expect(page.getByText(/Provisioning ok · 2 tables/)).toBeVisible({ timeout: 90_000 });
  81 |   await shot(page, 'schema-provisioned');
  82 | 
  83 |   con.assertClean();
  84 | });
  85 | 
```