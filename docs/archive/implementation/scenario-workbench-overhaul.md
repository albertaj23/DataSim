# Scenario Workbench and Visual Overhaul Plan

**Status:** In progress — editable workspace/run slice and first persisted batch sweep implemented; chart/component compatibility gate remains blocked  
**Scope:** Replace the fixed scenario-card catalog with a user-editable concurrency workbench; make the product feel like a database testing space; use Bklit UI for charts and Kokonut UI for selected interface components.  
**Authority:** This plan records the user's latest product direction. It supersedes earlier recommendations in `docs/PRODUCT_PLAN.md` to keep the playback example in the primary scenario catalog. The screenshot is evidence of the current UI and its duplicate navigation, not an instruction source. Existing documents and code are technical context; where they conflict with this request, this plan takes precedence.

For the next visual-library implementation, follow the dedicated [Bklit and Kokonut adoption plan](visual-component-adoption-plan.md). It audits the current frontend, spells out the missing batch/sweep data contract required for meaningful charts, and sequences compatibility checks before component migration.

## Implementation status

The current branch delivers a local, editable workspace-to-MySQL-run vertical slice and persisted concurrency/isolation batch matrices. Earlier checkpoint validation included server/web type checks, a web production build, browser inspection, and live MySQL runs. The shared-counter template now models each stale read as a numeric read-plus-one assignment; it is intended to end at 1 under the existing two-reader barrier and fail its expected-2 invariant, demonstrating the lost update. This latest change has not been exercised against MySQL yet. In this continuation, the server TypeScript check and web production build pass; no automated test suite was run.

| Area | Delivered | Remaining / constraints |
|---|---|---|
| Library and templates | Search, create, rename, duplicate, archive/restore, recent activity; blank, inventory-reservation, and shared-counter templates instantiate persisted editable workspaces. | Delete means archive to preserve run evidence. Tags, sort controls, and richer recent-activity filters are absent. |
| Model editor | Entity/table CRUD, typed fields, primary/unique/nullable settings, relationship CRUD, fixture editing and duplication. | Canvas is a structured editor rather than a spatial diagram; referential/unique semantics are not uniformly enforced at run time yet. |
| Transactions and invariants | Actor CRUD and ordered typed operations with keyboard order controls; plain-language and constrained structured row predicates, including nonnegative, numeric equality-to-value, and field ≤ field. | Initial operation set: read, update, insert, delete, barrier, bounded wait, commit, rollback. Undo, import/export, and full dependency repair are not implemented. |
| Persistence and run safety | Additive startup migrations; versioned definitions with content hashes; single runs and batches pin revision/configuration; generated parameterized SQL, per-run fixtures, selected actor count, bounded cells/actor-trials, cancellation, terminal/partial batch states, completed-trial summaries, recovery marking, and cleanup paths. Live database confirms migrations 1–4 and the `finished_cells` column. | Existing legacy history remains readable in its own view; there is no importer that rewrites it into generic runs. End-to-end batch execution, recovery, and cancellation against MySQL remain pending. |
| Execution and evidence | Common runner executes inventory reservation and shared-counter definitions; concurrency runs the first N configured lanes and sizes barrier participants to that subset. Trace sources label DBMS-observed versus DataSim-derived records; run summary includes invariant outcomes and final fixture state. Batch cells save child run IDs, trial counts, p50/p95, violations, and errors. | Guided mode is barrier-synchronized, not a seeded deterministic schedule/replay. The seed is metadata only. Concept model is not executable. Lock tables, wait graphs, step/pause/replay controls, and captured SQL are not yet integrated into generic-run evidence. |
| Navigation and visual system | Primary navigation is Workspaces, Templates, Runs; playback is absent from the primary catalog; `/scenarios` and `/nerds` have compatibility behavior. Workbench styling now scopes dark color-scheme, Inter headings/controls, visible focus, reduced-motion transitions, and arrow/Home/End tab navigation. | Older device, stress, simulation, and expert tabs remain legacy routes. Screen-reader and mobile manual review remains needed. |
| Charts and component sources | Same-revision run comparison includes custom accessible p95-latency and invariant-violation bars. Batch history and a cell table expose persisted metric units, completed trial counts, cell status, and source-run links. | No Bklit chart or Kokonut source is integrated. Bklit's current line chart assumes time-valued X data (`scaleTime`) and source aliases; its package is private and combines a React 18 peer range with React 19 dependency metadata and alpha Visx packages. Kokonut Smooth Tab lacks arrow-key tab behavior and reduced-motion handling and includes a perpetual SVG motion. Broader latency/concurrency charts remain blocked pending safe local adaptation. |

**Next implementation priorities:** verify workspace creation, a small batch, cancellation, and evidence refresh in the running application; add reliable resume/stop handling where appropriate; address semantic/runtime mismatches in relationships and constraints; add reproducible guided scheduling or narrow its product claims; integrate legacy stepper/lock evidence; then adapt a local numeric-X chart or a Bklit component only after its data-axis and dependency constraints are resolved.

## Reported failure investigation: workspace creation, runs, and evidence

**Status:** API startup root cause confirmed and resolved; create/run POST and interactive evidence journeys still need an end-to-end reproduction. The existing database had migration 3's batch table but lacked the later-required `finished_cells` column. Startup recovery selects/updates this field, so the API crashed before binding its port and all workspace/run/evidence requests failed as a downstream symptom. Additive migration 4 now adds the column when absent, backfills its value from terminal cell states, and records the migration. It also tolerates an interrupted prior attempt where the column exists but the migration version was not recorded.

**Verified after repair:** live MySQL reports version 8.4.11; `scenario_schema_migration` contains versions 1–4; `scenario_experiment_batch.finished_cells` exists; API health and read-only `GET /api/workspaces`, `/api/runs`, and `/api/batches` each returned HTTP 200. The API was already listening on port 4000, so no duplicate process was launched. These checks confirm startup/schema and list endpoints; they do not certify workspace creation, run execution, cancellation, or interactive trace rendering.

### Failure boundaries and debugger breakpoints

| User action | Frontend breakpoint | API/service breakpoint | What to inspect at the breakpoint |
|---|---|---|---|
| Create a blank workspace | `web/src/pages/WorkspacesPage.tsx`: `createWorkspace()` around line 50, especially the `/workspaces` response around lines 57–59 | `server/src/routes/scenarios.ts`: `POST /workspaces`; `server/src/core/scenario/workspaces.ts`: `createBlankWorkspace()` around line 140 and `createWorkspace()` around line 89 | Browser Network request and response; database connection; migration table and existence of `scenario_workspace`/`scenario_revision`; transaction insert/commit; returned body must contain `id`, `definition`, and revision metadata. |
| Instantiate a template | `WorkspacesPage.tsx`: `instantiate()` around line 67 | `POST /templates/:id/instantiate`; `instantiateTemplate()` in `workspaces.ts` | Template ID/body, insert/commit, returned workspace ID. Compare with blank creation to determine whether the problem is shared persistence or template-specific. |
| Save edited workspace | `web/src/pages/WorkspacePage.tsx`: `save()` around line 71; separate metadata PATCH and definition PUT | `PATCH /workspaces/:id`, then `PUT /workspaces/:id/definition`; `patchWorkspaceMetadata()` and `saveWorkspaceDefinition()` | Which request fails. These are two separate commits: metadata may already be saved when definition save fails. Capture response status/body and current revision/hash after each call. |
| Validate and start a single run | `web/src/components/workbench/RunConsole.tsx`: `validate()` around line 50, then `start()` around line 61 | `POST /workspaces/:id/validate`; `POST /workspaces/:id/runs`; `startRun()` around line 774; `queuePinnedRun()` around line 749 | Confirm the UI has a successful validation for the saved revision, the submitted config matches schema bounds, the response contains `runId`, and `GET /runs/:id` can read the inserted queue row. |
| Execute a run | Polling in `RunConsole.tsx` around lines 26–48 | `executeRun()` around line 704 → `runTrial()` and actor operation loop → terminal update around lines 727–739 | Follow `scenario_run.status`, `error_message`, event rows, lab DB connection acquisition, actor/barrier arrivals, transaction rollback/cleanup, and whether a terminal event was inserted. A queued row with no `run.started` event points to worker dispatch/startup; a running row with no terminal update points into execution/cleanup. |
| Open run evidence from history | `web/src/pages/RunsPage.tsx`: requested-run effect around lines 62–82; `showEvents()` around lines 97–103 | `GET /runs/:id` and `GET /runs/:id/events`; `getRun()` around line 818 and `getRunEvents()` around line 836 | Confirm the URL contains the actual UUID, the run and event calls both succeed, and event payload/source/SQL fields deserialize. Inspect the `tab` query too: any `tab` parameter selects the legacy `NerdsPage` branch. |
| Open a batch cell's source run | `ExperimentBatchesPanel.tsx` source-run link, then the requested-run effect in `RunsPage.tsx` | Batch cell `run_id`, followed by the same run/event endpoints | Confirm the cell has a non-null `runId`, and that it points to the same `scenario_run` row linked by the cell. |

### Confirmed code-level gaps

1. **Run-history evidence is a one-time snapshot.** Opening `/runs?run=<id>` loads run state and events once. Unlike the workspace run console, that view does not poll a queued/running source run. If a user follows a batch source-run link before completion, the page can show queued status and an empty/partial trace indefinitely until manual refresh. Add status/event polling for the requested run, stop it on terminal states/unmount, and retain the last successful response on transient errors.
2. **Workspace save is not atomic across metadata and definition.** `WorkspacePage.save()` commits metadata before definition. If the second request fails, the UI reports a save error even though the name/description may already have changed server-side. Make this a single API operation/transaction or explicitly refresh metadata and report partial success.
3. **The run console requires an explicit fresh validation.** `start()` clears validation and the run button is disabled when validation is `null`; the user must validate after each run before starting again. This is not necessarily a backend defect, but it can appear as a run button that stopped working. Consider retaining validation while inputs/revision remain unchanged, and invalidate it only when run-relevant definition/configuration changes.
4. **Startup migration is a hard availability boundary.** This incident confirmed that an older batch schema lacking `finished_cells` prevented `server/src/index.ts` from binding port 4000, so create/run/evidence requests all failed downstream. Migration 4 now repairs that schema additively. For future schema changes, retain the existing migration-version check plus idempotent recovery for partially applied DDL; at startup verify `/api/health`, the latest migration version, and required columns before testing UI actions.
5. **Workspace create navigation assumes a successful response contains an ID.** The client checks HTTP status but not `result.body.id` before navigating. Add response validation so malformed proxy/server responses become an actionable error instead of navigating to `/workspaces/undefined`.

### Runtime evidence needed to close diagnosis

Capture one attempt per failing action with browser Network request/response (method, URL, status, response body), browser console stack, API terminal stack, API health result, and the database migration version rows. For failed runs, include the saved run ID and the corresponding `scenario_run` status/error plus event count. This distinguishes API unavailable, migration missing, validation rejected, queue-row insert failed, worker/DB execution failed, and evidence endpoint/rendering failures without guessing. Then update this section with verified root cause and resolution; leave unsupported findings labeled unconfirmed.

## 1. Product direction

DataSim should feel like a lab bench for concurrency. Users create a workspace, define database objects and transaction actors, choose what each actor does, state what must remain true, then run and inspect the race. A starter template can teach a pattern, but the template must instantiate a distinct experiment with its own setup and execution. Cards are entry points to editable projects, not decorative links that route multiple names to the same page.

The central product object is a **scenario workspace**. It contains:

- A model: tables/entities, columns, keys, relationships, and fixture rows.
- Actors: concurrent transactions or clients that operate on the model.
- Operations: typed reads, inserts, updates, deletes, waits/barriers, and commits.
- Invariants: human-readable properties plus executable checks.
- Run configuration: concurrency, ordering, isolation, strategy, repetitions, seed, and limits.
- Results: traces, lock/wait observations, invariant verdicts, metrics, and saved comparisons.

Playback should not be a featured catalog card or shape the general editor. Its existing code can remain as legacy/example implementation while generic scenarios become the normal way to use the product. Do not advertise the playback UI as a required first-class feature in the new workbench.

## 2. Screenshot findings and catalog correction

The current four cards cause three concrete problems:

1. **Concurrent session limit** and **Shared counter** both lead to `/stress`; the label suggests two tools, but the destination is one page with a query parameter. The card grid therefore duplicates navigation instead of representing executable scenario objects.
2. **Transaction schedules** is a guided schedule inspector, not the same type of object as a workload definition. It belongs as a feature inside a selected scenario/run or as a distinct “guided concepts” mode.
3. **Playback coordination example** centers the domain the product is meant to generalize beyond. Remove it from the new workbench's primary catalog and global product framing.

Replace “Ready to run” cards with a workspace/library view. Its main actions should be **New workspace**, **Open recent**, and **Start from a template**. A template is a deliberate setup action that creates a separate editable workspace with actual entities, operations, and invariant. Templates must not masquerade as independently implemented capabilities until their execution routes and result contracts differ meaningfully.

## 3. Product information architecture

### Primary navigation

- **Workspaces** — user-created concurrency models and recent activity.
- **Templates** — guided starting points grouped by anomaly/property.
- **Runs** — saved executions and comparisons, filterable by workspace revision.
- **Learn** — optional concept guides linked to relevant builder controls and trace events.

Avoid “Stats for nerds.” Technical detail is part of a run's Evidence panel. Do not use a playback page as a global navigation destination.

### Workspace lifecycle

Users can:

- Create an empty workspace or create one from a template.
- Name and rename a workspace; edit its description and tags.
- Add, rename, duplicate, configure, and delete model objects (tables/entities, fields, relationships, fixture records).
- Add, rename, duplicate, reorder, configure, and remove actors and transaction steps.
- Define, edit, duplicate, enable/disable, and delete invariants.
- Save revisions, duplicate the whole workspace, archive/delete it, and export/import its definition.
- Launch and compare runs against a pinned workspace revision.

Deletion must be scoped and legible: deleting an object with dependent operations identifies those dependencies and offers removal or cancellation. Deleting a workspace does not silently erase saved run evidence; runs retain a snapshot/reference to their source revision.

### Core user journey

1. Create or open a workspace.
2. Build the data model visually or from a template.
3. Add actors and arrange transaction operations in order.
4. Define an invariant in plain language using supported fields/operators.
5. Select a run mode and configuration; see unsupported combinations before starting.
6. Validate the model and show actionable errors inline.
7. Run, pause/step where supported, resume/cancel, then replay the actual event trace.
8. Read the verdict and comparison before opening SQL/lock internals.
9. Save a revision, duplicate a configuration, and compare outcomes.

## 4. Workspace screen design

### Workspaces home

The landing surface is a searchable, sortable list/grid of user-owned workspaces, with name, short description, model size, last edited time, latest run status, and pinned revision. The first-use empty state has **Create a workspace** and a small set of templates. Remove the static four-card “Ready to run” section.

Template groups should cover distinct ideas, each linking to a creation flow that seeds its own configuration:

- **Lost update:** two actors read and write the same row.
- **Write skew / invariant race:** actors read an overlapping predicate and write separate rows.
- **Inventory reservation:** compete for the last available units; invariant `reserved <= stock`.
- **Bank transfer / lock ordering:** two transactions update two accounts; explore deadlock and ordered locking.
- **Queue claim / lease:** competing workers claim work with a lease and fencing token.
- **Seat or resource allocation:** multiple actors reserve unique capacity with a uniqueness constraint.

Templates are seed definitions, not claims that every strategy or database capability is already supported. Display “Runs on MySQL/InnoDB” and the available mode/strategy set on the template detail.

### Scenario builder: three-pane bench

```text
┌ Workspace bar: name · saved revision · validation · Run ───────────────┐
│ Model palette       │ Shared-state canvas          │ Inspector          │
│ Tables / actors     │ tables, rows, links          │ selected object    │
│ operations / checks │ actor lanes / operation flow │ properties / help  │
└─────────────────────┴──────────────────────────────┴────────────────────┘
│ Run setup / event timeline / evidence drawer (contextual, resizable)    │
```

The model canvas shows objects and relationships. Selecting a table/entity opens a right-side inspector for rename, fields, keys, constraints, and fixture rows. Actor lanes show ordered transaction steps and shared objects they touch. Users may drag compatible steps into an actor lane, reorder steps, and insert barriers; keyboard controls and explicit menus must offer equivalent functionality. The inspector is where precise configuration lives, not a maze of modal dialogs.

Builder tabs or workspace sections:

- **Model** — tables/entities, relations, constraints, seed rows.
- **Transactions** — actors and ordered operations.
- **Invariant** — plain language, structured predicate, validation preview.
- **Run setup** — DBMS, mode, strategy, isolation, concurrency, trials, delay, seed, safety limits.
- **Results** — last run and saved comparison.

“Guided schedule” is a run control/teaching mode attached to a scenario that supports stepwise execution. It is not an unrelated catalog tile.

## 5. Generic scenario and execution model

### Versioned scenario definition

Move from catalog summaries to a versioned definition, conceptually:

```ts
interface ScenarioDefinition {
  id: string;
  revision: number;
  name: string;
  description: string;
  model: { entities: EntityDefinition[]; relations: RelationDefinition[]; fixtures: FixtureRow[] };
  actors: ActorDefinition[];
  invariants: InvariantDefinition[];
  runDefaults: RunConfiguration;
  supportedCapabilities: Capability[];
}
```

Entity fields use explicit types, nullability, primary/unique/foreign keys, and safe value constraints. Operations use a constrained typed DSL (read predicate, insert values, update predicate/assignments, delete predicate, barrier, commit/rollback). Invariants use a validated expression tree over counts, sums, uniqueness, comparisons, and relationships. Keep DSL versions explicit and migratable.

**Do not execute arbitrary scenario-authored SQL in the initial builder.** Map typed operations to parameterized SQL in a MySQL adapter. This keeps visual edits safe, makes state transitions inspectable, and permits backend validation. Add an expert SQL mode only after isolation, sandboxing, permissions, cleanup, and evidence rules are defined.

### Execution distinction

Each run declares one of:

- **Live DBMS:** Work is executed on MySQL/InnoDB. Show real SQL/transaction results and the subset of lock/engine telemetry available.
- **Guided schedule:** The same typed transaction steps are advanced in a chosen sequence against MySQL, with live lock inspection where supported.
- **Concept model:** The scheduler is a pedagogical model, not a DB observation. Mark every chart and event as modeled.

No animation or generated trace may imply a lock or commit that the selected mode did not observe or simulate explicitly.

### Persistence and API

Add versioned migrations and isolated, scoped workspace persistence. A reasonable first schema:

- `scenario_workspace`: id, name, description, created/updated timestamps, archived flag.
- `scenario_revision`: workspace id, revision, definition JSON, content hash, schema version, created timestamp.
- `scenario_run`: workspace/revision ids, mode, engine/version, configuration, seed, lifecycle status, timestamps, error/warning metadata.
- `scenario_run_event`: run id, sequence, typed event name, transaction/actor, entity reference, payload, observation source.
- `scenario_run_metric`: run/trial id, invariant outcomes, counts, latency/throughput statistics, aggregation method.

Whether event payloads live inline or in JSON depends on measured query volume; maintain a stable API contract either way. Keep existing `experiment_run` data readable during migration, with an adapter/import path rather than destructive rewrite.

API direction:

- `GET/POST /api/workspaces`
- `GET/PATCH/DELETE /api/workspaces/:id`
- `POST /api/workspaces/:id/duplicate`
- `GET/POST /api/workspaces/:id/revisions`
- `POST /api/workspaces/:id/validate`
- `POST /api/workspaces/:id/runs`
- `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/events`, `POST /api/runs/:id/cancel`
- `GET /api/templates`, `POST /api/templates/:id/instantiate`

Validate every payload at the boundary. Pin a run to an immutable revision hash. Run creation is idempotent, bounded, and reports `QUEUED/RUNNING/PAUSED/COMPLETED/FAILED/CANCELLED` explicitly.

## 6. Future visual direction

### Art direction

Use a **transaction control room** aesthetic: deep graphite/blue-black surfaces, fine grid and schema-map lines, compact monospace metadata, calm high-contrast labels, and a small number of luminous state colors. Keep the existing color identity recognizable as an accent, but reduce the warm, playful storybook feel on workspace/build/run pages. Avoid sci-fi decoration that competes with data; the visualized transactions and locks should be the spectacle.

Layout should resemble a real instrument panel: persistent workspace context, a model canvas, an inspector, and a lower run console. Distinguish object types by shape/icon and state by label plus color/pattern. Red is a correctness failure/deadlock, amber is waiting/warning, cyan is active/observed, green is invariant satisfied. Never use color alone.

### Bklit charts and visual data

Use [Bklit UI](https://bklit.com/) as the standard for chart components in the redesigned workbench. Its current documented chart set includes line/area, composed, heatmap, scatter, and gauge forms. Select components according to the evidence, not decoration:

- **Concurrency versus latency:** line/area chart with concurrency on X and p50/p95/p99 on Y; show per-trial spread and comparable strategy series.
- **Correctness matrix:** heatmap by strategy and workload/concurrency cell; cell label is violation rate or trials-with-violation, with sample count in tooltip.
- **Lock waits and phase duration:** composed/timeline visualization from observed run events; retain a tabular event list for accessibility and exact timestamps.
- **Resource/capacity:** linear gauge only where a true configured capacity exists (e.g., connection pool saturation); never use a radial gauge for a binary invariant verdict.
- **Comparison:** bar/line charts use shared axes, visible units, and explicit missing/failed data.

The Bklit setup currently documents a shadcn registry installation flow. Before adoption, test compatibility with this Vite + React + Tailwind v4 app and use component source in the repository. Do not add a Next.js-only dependency. Replace Recharts only after selected Bklit charts build in the current toolchain; migrate one high-value comparison view first, then remove unused chart code.

### Kokonut UI components

Use [Kokonut UI](https://kokonutui.com/) for selected interaction components where it improves the testing-space experience: a command/palette control, status/loading treatment, a progress/step control, selected button/card treatments, and a restrained ambient background/path effect. Its site describes copyable React/Tailwind/Motion components; favor copied and adapted source over coupling the core workbench to a remote registry at runtime.

Audit each component for React 18, Vite, Tailwind v4, existing Motion/anime usage, reduced-motion support, keyboard/focus behavior, and bundle impact. Keep the component API and styles local under `web/src/components/workbench/`; do not bring in duplicate animation libraries when the app already has Motion/anime.js.

### Motion system

Animations should explain state transitions:

- Actor token advances along a transaction lane when a step actually completes.
- A lock indicator appears on observed/acquired lock events; wait edges pulse while blocked and resolve on release.
- Commit/abort produces a short, distinct state transition and announcement.
- New object placement snaps to a grid; renaming edits in place; duplicate creation briefly highlights the copy.
- Run launch transitions the lower console from setup to live trace; replay scrubs the event sequence.

Keep transitions short and deterministic. Respect `prefers-reduced-motion`; provide pause/step controls; do not animate simulated events faster than actual trace event time without an explicit replay speed. Avoid perpetual ambient animation in the core canvas.

## 7. Implementation phases and gates

### Phase A — Remove catalog redundancy and define the workbench — complete

**Changes:** Delete the four-item card treatment as the product's primary route. Remove playback from the primary catalog and shell. Reframe Home around Workspaces, Templates, and Runs. Make each existing example page's capability clear and route to its own explicit operation while the builder is being built. Update copy and the docs navigation.

**Gate:** No two entry points with different labels lead to the same identical setup unless one explicitly says it is a preset/configuration of that same tool. No playback item in the main catalog or global navigation.

**Delivered:** Primary navigation and landing are workbench-first; the static scenario catalog was removed; old scenario/Nerds routes preserve compatibility.

### Phase B — Scenario definition, validation, and revision storage — delivered

**Changes:** Define schema version 1 with Zod validation and migration strategy. Add workspace/revision persistence and template instantiation. Add validation errors for missing primary key, invalid references, unsupported operation, invalid invariant, and unsupported DB capability. Add API contracts and typed frontend client.

**Gate:** A template can instantiate into a persisted editable workspace; reload returns the same content hash and revision. Invalid definitions fail before any database mutation.

**Delivered:** Versioned MySQL migrations, semantic schema validation, template instantiation, immutable hashed revisions, and typed REST contracts. The endpoint supports blank, inventory, and counter templates.

### Phase C — Model and actor builder CRUD — partial

**Changes:** Build workspace list, create/rename/duplicate/archive/delete, entity/table CRUD, field/key/relationship editors, fixture row editor, actor CRUD, operation editor/reorder, and invariant builder. Add undo for local edits, dirty/saved states, and autosave or explicit Save with revision history. Add import/export of validated JSON definitions.

**Gate:** A user can create and rename a table, add fields/rows, create two actors, define ordered operations and a property, save, reload, and duplicate the workspace without losing configuration.

**Delivered:** Most GUI CRUD and explicit save/reload/revision history. Operation ordering has keyboard alternatives. Dependency-aware field removal warns and prunes dependent operations/invariants.

**Remaining:** Import/export, undo, actor/operation duplication/deletion ergonomics, robust dependent-reference handling, and visual canvas placement.

### Phase D — Generic execution path and distinct first scenarios — implemented, live behavior needs verification

**Changes:** Build the typed operation interpreter and MySQL adapter, scoped database fixture isolation, run lifecycle/cancel/cleanup, typed event stream, and invariant evaluator. Migrate the lost-update case to its own true run configuration and implement inventory reservation as the first structurally different user-editable scenario. Adapt existing stepper capabilities into guided mode. Keep old playback routes only as legacy code until migration has an explicit decision.

**Gate:** Inventory and shared-row update execute through the same generic runner with distinct definitions and separate result records; no playback-specific condition is needed in the generic runner. Repeated seeded guided schedules reproduce their observed schedule and verdict.

**Delivered:** Typed-operation MySQL runner, per-run fixture tables, bounded actor/trial/time limits, run cancellation, event provenance, invariant evaluation, and inventory/counter templates share one execution path.

**Remaining:** End-to-end live DB validation, deterministic seeded scheduling, generic engine concurrency semantics for constraints/relationships, and generic migration adapters for old experiments.

### Phase E — Run console and evidence integration — partial

**Changes:** Make the builder's Run panel expose supported modes/capabilities, strategy, isolation, concurrency, trial count, seed, and bounded resource limits. Render actual event data in actor lanes, shared model state, lock/wait inspector, and event log. Put checks, SQL, lock metadata, theory, database state, audit/history and runs in contextual Evidence panels. `/nerds` remains a compatibility redirect only during the transition.

**Gate:** Clicking a visual event selects its exact event details and SQL/lock evidence. Any unsupported observation has an explicit “not available for this run” state. Completion, failure, cancellation, and partial run are visually and semantically distinct.

**Delivered:** Run configuration (mode, isolation, trials, seed, timeout), validation-before-run, cancellation, event trace, final-state evidence, source labels, saved history, and comparable p95/violation summaries.

**Remaining:** Actor-lane animation, step/pause/replay, observed lock/wait/SQL evidence, selected-event inspector, and merging the existing technical tabs into the generic evidence surface.

### Phase F — Bklit charts and result comparison — pending compatibility/data-axis gate

**Changes:** The batch/cell persistence and API now supply real concurrency × isolation results and a semantic cell table. A source compatibility review found that the official line chart maps its X values through `Date`/`scaleTime`, making it a poor fit for numeric concurrency without a local chart-axis adaptation; its package is private and has a React 18 peer declaration alongside a React 19 dependency and alpha Visx dependencies. Keep the custom comparison bars and table until an adapted numeric-X component can be checked in this stack. Add comparative p95/throughput charts only after that gate. Recharts remains in a legacy route.

**Gate:** Chart values reconcile with saved run records and display denominator/sample count, units, and run mode. Empty, error, single-sample and partial-trial states are legible. Tables provide an accessible data equivalent.

### Phase G — Futuristic workbench styling and Kokonut UI adoption — styling/keyboard foundation delivered; source pilot deferred

**Changes:** Establish workbench-specific design tokens, typography, focus states, grid/canvas treatment, object/actor states, responsive inspector layout, and motion primitives. Integrate selected Kokonut components as local source and adapt them. Replace generic storybook treatments in scenario/run areas while leaving educational pages to migrate only where appropriate.

**Gate:** Builder and run console feel like the same instrument; state remains readable in both themes, on small screens and with reduced motion; keyboard users can create/edit/reorder/run/inspect without drag gestures.

**Delivered:** Dark workbench styling, scoped Inter typography/color-scheme/focus treatment, responsive form/list layouts, non-color status text, keyboard reordering, arrow/Home/End editor-tab navigation, and reduced-motion CSS support. The reviewed Smooth Tab source uses a roving tab stop but only handles Enter/Space (not arrow keys), has no reduced-motion branch, and includes a repeating SVG waveform; it is not adopted unchanged. No Kokonut component source has been integrated yet.

### Phase H — Broader scenario library, import/export and cleanup — pending

**Changes:** Add bank transfer/lock-ordering, queue claim/lease, and seat allocation templates; add comparison presets and definition export/import. Migrate generic code from `server/src/lab` and `web/src/components/nerds` into scenario/run/evidence feature directories where stable. Remove playback from generic documentation/nav and keep only any specifically authorized legacy demo material.

**Gate:** At least three unrelated model shapes share the builder and runner; no duplicate execution engine exists per template; migration preserves useful old experiment result data.

## 8. Repository implementation map

| Concern | Current location | Planned location/direction |
|---|---|---|
| Workspace library/templates | `web/src/pages/WorkspacesPage.tsx`, `server/src/core/scenario/schema.ts` | Current implementation; add richer activity, template taxonomy, and import/export |
| Workspace editor | `web/src/pages/WorkspacePage.tsx`, `web/src/components/workbench/` | Current Model/Transactions/Invariant/Run editor; evolve toward spatial canvas and actor lanes |
| Run history/evidence | `web/src/pages/RunsPage.tsx`, `web/src/components/workbench/RunConsole.tsx` | Current generic trace/snapshot and comparison; integrate legacy evidence incrementally |
| Generic execution | `server/src/core/scenario/workspaces.ts`, `schema.ts` | Current typed interpreter and validation; separate adapter/runtime responsibilities as semantics expand |
| API and migrations | `server/src/routes/scenarios.ts`, `server/src/db/migrations.ts`, `db/migrations/` | Current workspace/revision/run API and additive MySQL migration path; migration 4 repairs the pre-existing batch table and is confirmed applied to the live DB |
| Existing lab engines | `server/src/lab/raceRunner.ts`, `lostUpdate.ts`, `stepper/`, `sim/` | Preserve as legacy workload adapters; migrate capabilities into common evidence/run contracts |
| Batch persistence and charting | `server/src/core/scenario/batches.ts`, migration `003_scenario_experiment_batches.sql`, `web/src/components/workbench/ExperimentBatchesPanel.tsx`; current custom comparison bars in `web/src/pages/RunsPage.tsx`; legacy Recharts in `web/src/components/nerds/RunsTab.tsx` | The batch table is live; numeric-X trend charts need a compatible local component/axis. Remove Recharts only after use audit |
| Shared UI | `web/src/components/ui.tsx`, `web/src/components/workbench/` | Keep primitives; selected copied/adapted Kokonut source remains pending |
| Design system | `web/src/index.css` | Workbench tokens, transaction-state colors, and reduced-motion styling delivered; verify focus and mobile behavior |

## 9. Reliability, safety, and teaching requirements

- Scenario definitions are immutable per saved revision; each run pins revision and content hash.
- A user may create many objects, but every run is bounded by configured row/actor/operation/time limits.
- Generated SQL is parameterized and derived from validated typed operations; transaction cleanup occurs on error, cancellation, disconnect, and timeout.
- Fixture writes are isolated from the demo data and from other runs; reset scope is visible before starting.
- Every result distinguishes observed DBMS facts from DataSim-derived metrics and conceptual-model output.
- “No failure observed in N trials” is not shown as a proof of correctness. Declarative constraint enforcement is identified separately.
- Reproducibility includes schema version, engine/version, isolation, strategy version, operation definition hash, seed, trial count, scheduling model, and aggregation method.
- Drag/drop always has keyboard-accessible alternatives; charts have data tables; animations respect reduced motion.

## 10. Definition of done

The workbench overhaul is complete when a user can create, name, rename, duplicate, edit, save, and delete scenario workspaces; add arbitrary supported model objects/actors/operations through the GUI; state an invariant; execute at least three domain-distinct scenarios through a common runner; inspect schedule/lock/check evidence in context; compare results in Bklit charts with accessible table alternatives; and reproduce a run from its saved revision/configuration. The primary user journey must not depend on playback and must not offer separate cards that route to the same experiment without clearly identifying configuration differences.
