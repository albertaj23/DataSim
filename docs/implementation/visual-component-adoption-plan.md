# DataSim Visual Component Adoption Plan

**Status:** In progress — compatibility review and persisted batch foundation delivered; chart/component pilots deferred at a documented gate
**Audience:** The next implementation agent working on the DataSim concurrency workbench  
**Related plan:** [Scenario Workbench and Visual Overhaul](scenario-workbench-overhaul.md)

Before visual-library work resumes, resolve the reported workspace/run/evidence failures using the [failure investigation and breakpoint map](scenario-workbench-overhaul.md#reported-failure-investigation-workspace-creation-runs-and-evidence). Run-history evidence currently does not poll a requested queued/running source run; component work should not obscure this functional gap.

## Goal

Continue the existing workbench by adopting Bklit for evidence charts and selected Kokonut UI components for polished interactions, without destabilizing the currently usable template → edit → validate → run → inspect workflow. The result should feel like a focused concurrency lab: users can build a test model, run controlled experiments, see what the DBMS actually did, and compare outcomes without mistaking decoration for evidence.

This plan is deliberately incremental. First verify the component integration path against this repository, then establish the data needed for honest charts, and only then replace the current comparison UI. The current custom bars and accessible table remain useful until the replacement has matching semantics.

## Current implementation delta

- Added explicit actor concurrency to single-run configuration. The runner activates the first N configured lanes and constructs each barrier from that same selected actor set.
- Added additive migration `003_scenario_experiment_batches.sql` and create/read/list/cancel APIs for concurrency × InnoDB-isolation matrices. Server validation caps batches at 12 cells and 240 actor-trials. A batch pins the workspace definition/revision/hash, records engine/version, mode, selected axes, trials, timeout, a metadata-only seed policy, and the p95 aggregation definition; each cell links to a child run and keeps explicit terminal status, completed-trial count, p50/p95, violation count, and errors. Child run summaries retain completed trial outcomes after partial failure/cancellation.
- Added batch launch/history UI with progress and an accessible cell table. No trend chart is rendered until a compatible numeric-X chart source is available.
- Scoped workbench typography, native dark controls, focus treatment, and arrow/Home/End keyboard navigation for editor tabs.
- No Bklit or Kokonut code was copied and no new package was installed. The exact official source review below found blockers; keep Recharts for its legacy usage.

## Product and repository context

DataSim is a general DBMS concurrency testing workbench, not a scenario catalog centered on one domain. The user creates and names workspaces, defines tables/fields/relationships/fixtures, configures actors and typed operations, states invariants, and runs a bounded experiment against MySQL. Results include run status, summary metrics, violation evidence, event records, and a trace. The workspace library and editor are the primary product surface; older music/playback/device/stress pages are legacy surfaces and should not drive the new workbench's visual language.

The active implementation is a vertical slice, not the full intended simulator. Among the most relevant current files:

| Surface | Current implementation | Planning consequence |
|---|---|---|
| Workspace library | `web/src/pages/WorkspacesPage.tsx` | Use this for the testing-space entry point and workspace/template selection; do not restore a fixed set of redundant scenario cards. |
| Workspace editor | `web/src/pages/WorkspacePage.tsx`, `web/src/components/workbench/ModelEditor.tsx`, `TransactionsEditor.tsx` | Current editor is a structured tabbed form, not a free-placement canvas. Make the existing model/transaction/invariant/run flow clearer before introducing drag-canvas complexity. |
| Run console | `web/src/components/workbench/RunConsole.tsx` | Presents live/guided modes, progress, summary, and event evidence. Keep run state and evidence semantics visible while adding charts. |
| Run history and comparison | `web/src/pages/RunsPage.tsx` | Current same-revision comparison uses custom p95-latency and invariant-violation bars with a text/table equivalent. Two selected runs are a pairwise comparison, not a trend dataset. |
| Workspace data types | `web/src/lib/workspaces.ts` | Single runs include optional concurrency for compatibility with old saved JSON. Experiment batches add only concurrency and isolation axes; no strategy selector exists in the runner. |
| Existing chart precedent | `web/src/components/nerds/RunsTab.tsx` | Recharts is still used on a legacy technical page. Audit before removing it; do not assume the entire repository has migrated when only the new comparison view changes. |
| Theme and animation | `web/src/index.css`, `web/src/lib/motion.ts`, `web/src/App.tsx` | Workbench styling already has a dark blue/black direction and reduced-motion support. Motion and animejs are both installed; components must have one animation owner. |
| Routing/build | `web/vite.config.ts`, `web/src/App.tsx` | The application is hosted under `/DataSim/`. Copied components must not add root-relative links, asset paths, or assumptions that break the configured base path. |

The current workbench styles are scoped/hard-coded dark while the wider app has a global theme system and legacy warm/playful styling. Keep the concurrency workbench visually coherent as a dark lab, but scope its tokens and typography so this work does not silently restyle every legacy page. Inter and JetBrains Mono are already available; avoid adding a font dependency for this pass. In the workbench, use Inter for interface text and JetBrains Mono for SQL, IDs, event time, and numeric evidence; prevent the global display font from making technical workbench headings feel storybook-like.

## Findings from the component sites

Bklit documents a shadcn registry installation flow: components are installed as source into the project and bring component-specific dependencies. Its chart API is composable, with line charts, heatmaps, gauges, and related forms. The line chart documentation describes markers, tooltips, multiple series, and smooth updates; these are useful for actual run sweeps. The heatmap supports configurable cells and an interactive legend, which suits a strategy/workload result matrix once such a matrix exists. The gauge is appropriate for a real bounded capacity measure, such as observed connection-pool occupancy, but not for a correctness verdict. ([Bklit installation](https://bklit.com/docs/installation), [line chart](https://bklit.com/docs/components/line-chart), [heatmap](https://bklit.com/docs/components/heatmap-chart), [gauge](https://bklit.com/docs/components/gauge-chart))

Kokonut documents copyable React components built for Tailwind CSS v4; the shadcn namespace is optional for direct copy/paste use. `Smooth Tab` uses Motion for the active indicator/content transition. `Background Paths` animates SVG paths and can add restrained atmosphere to an otherwise quiet entry/header surface. `Beams Background` uses a canvas and should not run continuously behind an active editor or high-frequency trace. ([Kokonut installation](https://kokonutui.com/docs), [Smooth Tab](https://kokonutui.com/docs/navigation/smooth-tab), [Background Paths](https://kokonutui.com/docs/backgrounds/background-paths), [Beams Background](https://kokonutui.com/docs/backgrounds/beams-background))

### Compatibility spike outcome (source review)

**Bklit:** The official repository marks `@bklitui/ui` private, so it is not a suitable direct runtime package. The official registry line-chart source is MIT-licensed and is intended to be copied, but it is a time-series chart: `time-series-chart-shell.tsx` normalizes X values to `Date` and uses Visx `scaleTime`. That does not represent an integer actor-count axis faithfully without modifying chart internals. The source also imports internal chart/context/tooltip/axis files, `@/lib/utils`, `@visx/responsive`, `@visx/scale`, `d3-array`, Motion, and registry metadata declaring alpha `@visx/curve`/`@visx/shape`. The UI package advertises a React 18-or-19 peer range, while its package dependencies include React 19; the local app uses React 18.3.1 and Vite aliases do not define the registry's shadcn paths. No package installation or broad shadcn setup was attempted. **Decision:** defer Bklit line-chart adoption until a local numeric-X chart variant is audited against actual component internals, dependency sizes, accessibility, and React 18.

**Kokonut:** The official MIT Smooth Tab source is React/Motion-compatible in principle, but its current interaction sets `tabIndex=-1` on inactive tabs and handles only Enter/Space; it does not implement Arrow/Home/End tab movement or include labelled tab panels. It also runs repeating SVG waveform motion without a reduced-motion branch, uses a fixed four-column/400px layout, dynamic Tailwind classes, and a `@/lib/utils` alias. The current editor tabs now provide arrow/Home/End focus and selection directly; copying Smooth Tab unchanged would regress behavior. **Decision:** defer the animation pilot; do not add a second animation owner or copy its perpetual decorative path.

## Critical dependency: make charts represent actual experiment data

The initial batch contract now produces persisted concurrency × isolation cells, but it does not support a strategy axis, seeded scheduling, throughput, or a workload matrix. Do not draw latency-vs-concurrency lines, strategy heatmaps, or workload matrices from hard-coded, inferred, or unrelated runs.

Before implementing trend charts, add an explicit experiment/batch concept in the API and persisted model. A batch should contain:

- A fixed immutable workspace revision and its content hash.
- A declared matrix of configurations, including only concurrency/actor count and isolation dimensions the runner actually supports.
- A recorded seed policy, trial count, timeout, engine version, and run mode for each cell. The current seed is metadata only and does not control scheduling.
- Child run IDs linked to the batch and cell/configuration identity.
- Per-trial child-run outcomes plus documented aggregation rules for available measures. Current batches persist completed child trial summaries, per-cell p50/p95 actor-time, violations, counts, and explicit incomplete/failed states; they do not claim throughput.
- The ability to identify incomparable results (revision hash, database engine/version, mode, isolation, strategy, and measurement definitions).
- A batch status that handles queued, running, complete, failed, cancelled, and partial batches without reporting missing cells as zero.

Use a server-side schema/API migration before building charts that depend on this data. Keep existing individual runs valid and readable. Existing run summaries can continue to power a precise two-run comparison while batch support is developed.

## Proposed visual system

Treat the workbench as a readable control surface rather than a decorative sci-fi dashboard.

- **Field:** deep blue-black canvas with a faint grid only where it helps orient the model or trace.
- **Panels:** cool near-black surfaces, clearly separated by borders and surface levels instead of heavy shadows.
- **Signal colors:** cyan/blue for selected/running, green for satisfied/healthy, amber for blocked/waiting/uncertain, and coral for violation/failure. Every state also has a text label or icon; color is never the only status channel.
- **Typography:** Inter for controls and explanatory copy; JetBrains Mono for identifiers, SQL, timing, and metrics.
- **Hierarchy:** one primary action per screen, stable placement of run controls, visible saved revision/status, and progressive disclosure for raw event/SQL details.
- **Motion:** animate only state changes that aid understanding (selected tab, run progress, event selection, new evidence). Avoid perpetual movement in the editor and avoid animation that implies a lock/order the database did not observe.
- **Responsive structure:** library cards collapse to a single column; editor panels stack with persistent section navigation; run console prioritizes timeline/evidence over decorative side panels on narrow screens.

The workspace should eventually read as a three-zone lab: workspace/model navigation, central editing or observed schedule, and a contextual inspector. Do not turn this into a freeform node canvas until object duplication/deletion, relationships, undo, keyboard access, and reference integrity are settled. A precise form/editor is a better testing tool than a canvas that looks advanced but is hard to trust.

## Component adoption map

### Bklit

| Component | Use | Data requirement | Guardrail |
|---|---|---|---|
| Line chart | First broad comparison chart: p95 actor-time across the runner's declared actor-concurrency sweep, with isolation as series. Include per-cell trial count and a clear aggregate label. | Completed batch with multiple valid numeric x-axis points, trial outcomes, fixed revision and compatible run dimensions. | Do not encode concurrency as dates for a time-series component; no line chart from just two hand-selected runs unless explicitly a pairwise comparison. Never connect missing/failed cells as zero. |
| Heatmap | Strategy × concurrency/workload view for violation rate or another clearly named metric. | Batch matrix with stable cell identity, denominator, valid trial count, and consistent semantics. | Show empty/partial/error cells distinctly; include a legend and accessible equivalent table. Never encode “safe” solely as green. |
| Composed/trace chart | Only after generic event evidence records observed waits/lock phases with timestamps and provenance. | Normalized observed event stream and clear distinction between DBMS observations and DataSim-derived labels. | Keep event table and exact timestamp details beside/under chart. No synthetic lock behavior. |
| Gauge | Optional live/batch summary for a bounded measured quantity such as configured vs observed connection-pool occupancy. | Explicit numerator/denominator and source. | Never use a gauge for “correctness”, quality score, or a metric without a meaningful bound. |

Start with **one** Bklit chart only after the source can show the batch's numeric concurrency axis faithfully. The reviewed official LineChart is time-series/date based, and the batch data now exists but the component gate does not pass. Keep the current custom pairwise bars and batch cell table until a local numeric-axis adaptation is verified; retain a semantic table as the exact-value equivalent.

### Kokonut

| Candidate | Recommended location | Recommendation |
|---|---|---|
| Smooth Tab | Workspace editor's Model / Transactions / Invariant / Run section navigation | Pilot only if the copied component retains semantic tab roles, keyboard behavior, focus visibility, and direct URL/base-path behavior. If it does not, keep the existing tabs and borrow only its restrained indicator treatment. |
| Background Paths | Quiet workspace-library header or empty state | Optional atmospheric accent; keep contrast low, stop/limit motion under reduced motion, and ensure no content depends on it. |
| Toolbar or command control, if a suitable current component exists | Future editor object actions (add/duplicate/rename/delete) | Adopt when the user-facing object operations are being added; ensure icon actions have labels and disabled/error states. |
| Beams Background | None in active workspace/run screens | Avoid for the live editor/trace because its canvas animation can compete with data and consume rendering budget. |

Kokonut components are copied/adapted into the repository rather than loaded dynamically. Choose at most one interaction component for the first visual pilot. Do not add components just to create a vendor checklist.

## Implementation sequence

### Phase 0 — Compatibility spike and integration boundary

1. Inspect the exact upstream source and dependency metadata for one candidate Bklit chart and one candidate Kokonut interaction. Do not change global styling, routing, or shadcn configuration during the spike.
2. Confirm React 18 compatibility, Tailwind 4 conventions, CSS requirements, accessible markup, server/client assumptions, animation dependencies, and axis semantics for the actual dataset.
3. This repository does not currently use `components.json` or a configured shadcn component alias. Do not run a broad `shadcn init` as a prerequisite without first reviewing every generated config change. Prefer copying the minimum source and dependencies into explicit local folders (for example `web/src/components/charts/bklit/` and `web/src/components/vendor/kokonut/`) and adapting imports to existing project conventions.
4. Check license/source attribution requirements, package duplication, bundle impact, and browser-console warnings. Keep chart and UI source local and reviewable.
5. Confirm components behave under the `/DataSim/` base path, narrow viewport, keyboard-only use, and `prefers-reduced-motion`.

**Gate:** One chart renders representative real data on a semantically correct numeric axis, one UI component works in isolation, and no global app config or existing workbench flow changes unexpectedly. The current source review did not pass this gate; continue with persisted data and accessibility foundations rather than substituting misleading chart marks.

### Phase 1 — Stabilize workbench tokens and layout

1. Define scoped CSS tokens for workbench surfaces, border, grid, text levels, signal states, focus ring, radius, and spacing.
2. Align workbench headings and metadata with Inter/JetBrains Mono; do not revise the legacy app theme wholesale.
3. Resolve the theme-toggle mismatch: the workbench should present a deliberate dark lab surface, not mix global light-theme assumptions with hard-coded dark panels. Preserve the user's ability to navigate away without changing legacy page behavior.
4. Refine the existing library/editor/run layouts at desktop and mobile sizes before adding decorative backgrounds.
5. Add a small motion contract: state change only, one animation library owns each animated element, reduced motion disables or simplifies transitions, and no animation obscures a live status.

**Gate:** Workspace creation, template entry, save/revision, validation, run, evidence selection, and run history remain visually and functionally legible at supported widths; focus and status are clear without color.

### Phase 2 — Add experiment batches/sweeps to the data model — implemented, live-DB validation pending

1. Design additive persistence for batch definition, batch configuration cells, child runs, and per-trial measurements. Use immutable workspace revision hashes as the experiment input.
2. The current supported axes are actor concurrency (first N configured lanes) and InnoDB isolation only; the runner exposes no strategy sweep. Duplicate values, actor bounds, timeout, a 12-cell cap, and a 240 actor-trial budget are validated server-side.
3. Preserve seed policy, isolation, database engine/version, mode, and metric definition in the batch snapshot; child run rows retain actual engine/version and trial outcomes. Seed is metadata only and does not control schedules. Cell and batch failure/cancellation/partial outcomes are explicit.
4. Expose create/read/cancel batch APIs and return all metadata the charts need; never let the browser fabricate missing summary values.
5. The workspace Run panel previews axis selections, cell count, actor-trial budget, progress, statuses, and source-run links in a semantic table.

**Gate:** Persistence, create/read/list/cancel APIs, and UI are implemented; verify migration, actual batch lifecycle/cancellation/restart recovery, and source-run consistency against MySQL before calling the phase operationally complete.

### Phase 3 — Adopt first Bklit chart

1. Adapt or choose a Bklit component that supports a numeric actor-count X axis. The current time-series LineChart is not a faithful fit without a local axis change.
2. Include unit, aggregation definition, trials per point, engine version, run mode, isolation, and revision identity in chart context or adjacent metadata. Do not imply a strategy dimension; the current runner does not expose one.
3. Add confidence/spread display only if trial data and a defined calculation support it; otherwise label the chart as an aggregate and link to raw trials.
4. Add no-data, running, partial, failed, and incompatible-comparison states before polishing animation. Until the chart gate passes, the cell table remains the only batch visualization.
5. Retain an equivalent semantic HTML table with all plotted values, counts, and units.

**Gate:** Every visible mark maps to a persisted run/trial; a user can inspect the source runs, exact values, and the conditions that make them comparable.

### Phase 4 — Add Bklit heatmap after matrix support

1. Add a strategy × concurrency heatmap for a single defined outcome such as invariant violation rate. Include valid trial denominator in tooltip/cell detail.
2. Distinguish zero violations from no data; distinguish an unsupported configuration from a failed run.
3. Add a selectable metric only when units/aggregation semantics are consistent across the matrix.
4. Provide the same matrix as an accessible table and allow filtering to inspect exact runs.

**Gate:** Matrix completeness and denominators are visible, and users cannot mistake unavailable cells for safe outcomes.

### Phase 5 — Add selected Kokonut interaction

1. Defer Smooth Tab unless its local adaptation includes arrow-key roving, labelled panels, reduced-motion behavior, responsive sizing, and no decorative infinite animation. The native editor tab set now has arrow/Home/End navigation.
2. Introduce Background Paths only on a quiet landing/library header after the core surfaces are stable; avoid an always-on canvas in the builder or run console.
3. Add object action controls (rename, duplicate, delete, add) when the corresponding reliable operations and dependency handling exist. Buttons should communicate object identity, impact, and undo/confirmation behavior where needed.
4. Keep animation brief and functional; test under reduced motion. Ensure Kokonut/Motion is not also animated by animejs.

**Gate:** The copied component improves task clarity, keeps keyboard behavior, respects reduced motion, and does not create a second visual language.

### Phase 6 — Consolidate, document, and remove superseded code

1. Search all imports/usages before removing Recharts; it remains used in a legacy technical page today.
2. Remove a dependency only when no active/legacy route still needs it or the relevant route has been intentionally migrated.
3. Update the implementation plan, product plan, and README with what shipped and what data/visual surfaces remain pending.
4. Record which values are directly observed from MySQL, which are computed by DataSim, and which are explanatory labels in every chart/evidence view.

**Gate:** No duplicate chart libraries are removed prematurely; docs accurately reflect current behavior and migration limits.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Registry tooling mutates or assumes shadcn paths/config not present here | Copy the smallest selected source files after a compatibility spike; review generated config diffs; avoid global initialization. |
| Beautiful graph implies unsupported comparison | Make batch/sweep persistence a prerequisite; expose comparison context and denominators. |
| Partial/failed runs appear as zero or “safe” | Model explicit cell states and distinguish zero outcomes from missing evidence. |
| Tailwind/component styles leak into legacy pages | Scope all new tokens and component styles to workbench routes/classes. |
| Motion causes jank or lies about observed ordering | Animate only UI state transitions; never animate inferred concurrency as observed; test reduced-motion mode and a long event list. |
| Current dual theme systems conflict | Establish deliberate workbench-scoped dark tokens and test the global theme control at route boundaries. |
| Deleting Recharts breaks legacy analytics | Run a usage/import audit and retain it until all dependent pages are migrated. |
| Canvas effects compete with tracing | Avoid continuous canvas backgrounds in editor and run console; use static grid or restrained SVG on quiet surfaces only. |
| Narrow viewport hides controls/evidence | Design responsive stack and preserve run control, status, and evidence selection priorities. |

## Acceptance criteria for this adoption work

- Workbench entry points describe general workspaces/templates and do not reintroduce redundant scenario cards that route to the same configuration.
- Existing workspace, revision, validation, run, and evidence journeys still work.
- Any Bklit chart is driven only by persisted, comparable experiment data and names its units, run count, and aggregation.
- Batch charts distinguish zero from missing, partial, unsupported, and failed data.
- Every chart has an accessible text/table equivalent and keyboard-usable controls.
- Kokonut source is local, scoped, and has no runtime registry requirement; adopted interactions have clear keyboard and reduced-motion behavior.
- The dark testing-space direction is consistent across library, builder, run, and evidence surfaces without forcing legacy routes into a global redesign.
- `/DataSim/` deployment paths work; the chart adoption does not silently break the configured base URL.
- Recharts is removed only after an explicit usage audit proves it is unused.
- Documentation identifies delivered functionality and unresolved evidence/data limitations accurately.

## Suggested handoff order

For an implementation agent optimizing for steady progress, do these in order and stop at each gate:

1. Phase 0 source/dependency review is complete; its Bklit numeric-axis and React/dependency blockers are documented.
2. Phase 1 scoped typography, dark native controls, focus, and editor-tab keyboard support are in place; continue responsive/manual review.
3. Phase 2 persistence/API/UI exists; validate a real batch against the non-reset local database and exercise cancellation/recovery.
4. Resolve numeric-axis/source compatibility, then ship one chart with the semantic table.
5. Add heatmap only after Phase 4 data gate passes.
6. Adopt one Kokonut interaction after the compatibility and accessibility gate.
7. Audit legacy Recharts usages and update docs.

This order makes the first visible chart correspond to a real experiment capability, and keeps component integration reversible while the data model evolves.
