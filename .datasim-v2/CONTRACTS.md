# Shared contracts and conventions (read with DATASIM_V2_BRIEF.md)

## Ground rules for every builder
- Work in the shared working tree on branch `v2`. **Only edit the paths you own.** Never edit `package.json`/lockfile (ask the lead), never run `git add/commit/checkout/stash` (the lead commits).
- Never use bash heredocs for files containing backslashes (they get mangled); use the Write/Edit tools.
- Run only your own tests (`npx vitest run <file>` inside the workspace) plus `npm run typecheck` for your workspace. Other builders are editing other paths at the same time, so a transient error in a path you do not own is not yours: re-run later, do not "fix" it.
- Tests that touch MySQL use the Docker DB (already up: MySQL on 127.0.0.1:3307 root/root, Redis on 6380). Sandbox databases are named `dsim_<shortid>`. Do not drop/alter the `datasim` meta tables or the legacy tables.
- Old v1 code is available for reference via `git show v1-friend:<path>` (e.g. the old Lab/Stepper UI in `web/src/components/nerds/*`).
- Honesty rule: no placeholder data, no `Math.random()` charts, no "coming soon". Every number shown carries a provenance tag (MEASURED / EMULATED / PROJECTED).
- Finish with a report: done / not done / how verified.

## Layout
- `shared/src` (`@datasim/shared`, TS source, imported by server via tsx/vitest and by web via Vite): `schema.ts` (SchemaModel, ValueGenerator), `design.ts` (DesignDoc, nodes, workload, SLO, `emptyDesign`), `run.ts` (RunOverrides, RunReport, RunSample, Finding, FindingFix, Capacity*, socket event types), `rules.ts` (`canConnect`, `validateDesign`, `extractPlaceholders`, `strategyFor`, `MAX_TOTAL_POOL`), `problems.ts`, `api.ts` (REST DTOs), `prng.ts` (`Rng`, `zipfSampler`, `hashSeed`), `generators.ts` (`makeGenerator`, `previewGenerator`, `evalExpression`), `ddl.ts` (`generateDdl`, `createTableSql`, `q`). `shared/src/usl.ts` is owned by the engine builder (exports `fitUsl`, `uslThroughput`) and is exported from `index.ts` by the lead.
- `server/src`: `db/{pool,tx,errors,migrations,runner,redis,namedLock}.ts` (existing helpers; `db/runner.ts` has `createRunnerPool(database, limit)` for the restricted `dsim_runner` user with `namedPlaceholders`), `engine/**` (engine builder), `projects/**`, `templates/**` (projects builder), `routes/*`, `realtime/{socket,runEmitter}.ts` (`emitRun(runId, event, payload)` -> Socket.IO room `run:<id>`; clients join with `socket.emit('join_run', {runId})`), `engine/active.ts` (`setActiveRunId`).
- Meta DB tables: `db/migrations/005_datasim_v2.sql` (project, project_draft, design_revision, run, run_sample, run_txn_stat, run_statement_stat, run_lock_wait, run_invariant, run_finding, capacity_point, capacity_fit).
- Web: `web/src/{ui,lib,pages,features}`; routes: `/` Projects, `/p/:id` Studio, `/runs`, `/runs/:id`, `/compare?ids=`, `/lab`, `/stepper`. App URL `http://localhost:5173/DataSim/`.

## Server service interfaces (projects builder delivers `server/src/projects/service.ts` FIRST, within ~20 min; engine builder codes against these signatures)
```ts
export async function getProject(projectId: string): Promise<ProjectDetail | null>;
export async function getDraft(projectId: string): Promise<DesignDoc>;
/** Pins the draft as an immutable revision. Reuses the latest revision when content_hash is unchanged. */
export async function pinCurrent(projectId: string, note?: string): Promise<{ revisionNo: number; design: DesignDoc; created: boolean }>;
export async function getRevision(projectId: string, revisionNo: number): Promise<{ revisionNo: number; design: DesignDoc; contentHash: string; createdAt: string } | null>;
/** Applies a machine-applicable finding fix to the draft, then pins a new revision. */
export async function applyFix(projectId: string, fix: FindingFix, note?: string): Promise<{ revisionNo: number; design: DesignDoc }>;
export async function createProjectFromDesign(name: string, design: DesignDoc, opts?: { description?: string; templateKey?: string | null }): Promise<string /* projectId */>;
```
Engine exports (engine builder), used by routes:
```ts
// server/src/engine/index.ts
export async function startRun(args: { projectId: string; revisionNo: number; design: DesignDoc; kind: 'LOAD' | 'CAPACITY'; overrides: RunOverrides; parentRunId?: string; kindOverride?: 'STRATEGY_CHILD' }): Promise<{ runId: string; done: Promise<RunSummary> }>; // rejects fast with ServiceError(409,'RUN_ACTIVE') if another run is active
export async function cancelRun(runId: string): Promise<boolean>;
export async function loadReport(runId: string): Promise<RunReport | null>;
export async function listRuns(q: RunListQuery): Promise<RunSummary[]>;
export async function provisionSandbox(projectId: string, design: DesignDoc, opts?: { rowScale?: number; onProgress?: (e: ProvisionProgressEvent) => void }): Promise<ProvisionResponse>; // used by Schema Designer "provision" + e2e
export async function testTransaction(projectId: string, design: DesignDoc, body: TestTxnBody): Promise<TestTxnResponse>;
export async function sandboxQuery(projectId: string, sql: string): Promise<QueryResponse>; // read-only SELECT, 200-row cap
```

## REST (see brief 4.7). Error body: `{ code, message }` via `ServiceError` in `services/liveStrategy.ts` and `errorHandler` in `routes/http.ts`. Extra endpoint: `POST /api/projects/:id/apply-fix` body `ApplyFixBody` -> `{ revisionNo }`.

## Web conventions
- Dark-first tokens in `web/src/index.css`; shared components in `web/src/ui/*` (barrel `web/src/ui/index.ts`); `api` client in `web/src/lib/api.ts` (`api.get/post/put/patch/delete` returning `{ ok, status, body }`); socket in `web/src/lib/socket.ts`; toasts via `useToast()`; format helpers in `web/src/lib/format.ts`.
- Only lucide-react icons at 16px stroke 1.5. No emojis, gradients, mascots.
