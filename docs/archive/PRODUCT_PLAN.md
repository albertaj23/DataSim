# DataSim Product Plan: A General Concurrency Testing Workbench

**Status:** Product direction with an implemented workbench vertical slice  
**Purpose:** Evolve the current MVP from a playback-themed demonstration into a general, reliable visual testing ground for DBMS concurrency.  
**Guiding reference:** The accessibility of a guided simulator such as Cisco Packet Tracer, applied to transactions, schedules, isolation, locking, anomalies, and recovery.

### Implementation snapshot (current repository)

The primary product is now a workspace library, template picker, editable workspace, and generic run-history flow. Users can create, search, rename, duplicate, archive/restore workspaces; instantiate blank, inventory-reservation, and shared-counter definitions; edit tables, fields, relationships, fixtures, actors, typed operations, and supported invariants; validate and save immutable hashed revisions; and execute bounded MySQL/InnoDB runs with explicit actor concurrency, cancellation, persisted events, final-state evidence, and same-revision comparisons. Experiment batches pin the same revision and sweep supported actor counts against InnoDB isolation levels, persisting cell status, child runs, completed-trial summaries, metadata-only seed policy, and aggregation definition. Additive server-startup migrations preserve the existing database volume and legacy experiment history. `/scenarios` routes to templates and `/nerds` routes to `/runs` while query-based legacy evidence views remain available.

This is a usable but incomplete vertical slice, not completion of the full roadmap. The generic runner currently supports a constrained typed-operation set and three invariant forms; batch results currently have an accessible table but no Bklit chart. Guided schedule seed/replay semantics, concept modeling, observed lock/wait evidence, actor-lane visualization, broader scenario families, import/export, and a production-grade comparison/chart system remain gaps. See the explicit delivery matrix in [The Scenario Workbench and Visual Overhaul Plan](implementation/scenario-workbench-overhaul.md), which is the current implementation authority and supersedes conflicting fixed-catalog and playback-first recommendations below.

## 1. Product direction

DataSim should let a learner or practitioner construct, run, inspect, and compare concurrent workloads against a database system. A scenario is a teaching and reproducibility wrapper around a database invariant or behavior; it is not the identity of the product. Existing playback code may remain as isolated legacy code during migration, but it is not a required catalog entry, default domain, product vocabulary, navigation model, or architectural assumption.

### Product promise

> Build a concurrency scenario, run it against a clearly identified engine and configuration, see what each transaction did and why, and compare the correctness and performance consequences of alternative designs.

### Product objectives

1. Make concurrency behavior understandable without requiring users to begin with SQL or database internals.
2. Make advanced inspection available in context: schedules, transaction state, locks/waits, deadlocks, isolation, invariant checks, and metrics.
3. Make runs reproducible and honest about what was simulated versus what was executed on a real DBMS.
4. Support multiple scenario families and invariant shapes without tying the simulation engine to playback entities.
5. Help users turn observations into engineering decisions by comparing correctness, latency, throughput, retries, aborts, and resource costs.

### Non-goals for the first general-purpose release

- Replacing a production database, providing a general SQL IDE, or claiming to model every DBMS implementation detail.
- Supporting arbitrary user-defined SQL safely on shared/remote infrastructure. Initial authoring can use curated operations and a constrained scenario definition.
- Distributed consensus, network partitions, or multi-region simulation unless a future milestone defines an explicit model.
- Removing the existing playback scenario before a general scenario proves the framework and migration path.

## 2. Product model and terminology

Use a consistent conceptual model across interface, backend, and documentation:

| Concept | Meaning | Example |
|---|---|---|
| Workspace | The user's area for experiments and saved work | “Inventory experiments” |
| Scenario | A reusable definition of state, actors, operations, concurrency, and expected properties | Two buyers reserve the last item |
| Invariant | A condition that must remain true after any committed schedule | Available stock never drops below zero |
| Run | One execution of a scenario with a fixed engine/configuration/seed | 32 workers, InnoDB RR, 20 trials |
| Schedule / trace | Ordered events and transaction steps observed in a run | T1 read, T2 read, T1 write, T2 write |
| Strategy | A concurrency-control implementation or application pattern under comparison | Naive, row lock, optimistic CAS |
| Evidence | Checks, lock observations, SQL/events, and metrics supporting the result | Violation count, deadlock report, p95 |

“Experiment” may remain as the umbrella for a scenario configuration and its runs. Avoid “music,” “listener,” “playback,” and “song” in generic shell/navigation/product copy. Keep those terms inside the playback example, its implementation, and clearly scoped documentation until migrated.

## 3. Current-state assessment

### Strengths to preserve

- `server/src/strategies/` already separates multiple concurrency strategies.
- `server/src/lab/` has race, lost-update, invariant, index, stepper, and crowd-simulation capabilities.
- `server/src/lab/stepper/` runs real database statements step by step and inspects InnoDB locks.
- `experiment_run` stores run configuration and outcomes; `scripts/bench.ts` supports repeatable batch experiments and CSV output.
- React story components, charts, live updates, comparison UI, database overlay, and technical tabs provide useful interaction patterns.
- Existing tests exercise backend behavior against MySQL and front-end logic.

### Product gaps to address

- The README, schema, seeded entities, landing page, route names, sidebar, and UI copy establish playback as the product rather than an example.
- The app has separate “Stress test,” “Simulation,” and “Stats for nerds” destinations. Core evidence is split away from the friendly workflow, and “nerds” frames technical inspection as a separate audience/product.
- Current scenarios and simulation types are coupled to accounts, devices, sessions, and songs; adding an unrelated domain should not require cloning engines or adding domain-specific branches throughout the core.
- “Simulation” can mean a visual model or real database execution. Each surface/run must clearly distinguish real DBMS results, deterministic schedule playback, and illustrative/synthetic activity.
- Runs need a stronger reproducibility envelope: engine/version, schema/scenario revision, isolation, strategy version, seed, trial count, timing boundary, and environment limits.
- Reliability and pedagogical clarity require more than a final pass/fail: users need to understand assumptions, uncertainty, failed/aborted transactions, and why the observed outcome occurred.

## 4. Target user journey

1. **Choose a starting point:** Select a guided concept (lost update, write skew, deadlock, phantom, dirty/non-repeatable read) or start from a domain template.
2. **Describe the property:** State the invariant in plain language; optionally inspect its formal predicate and database check.
3. **Set up actors and operations:** Use visual tables/records and transaction cards; configure actor count, operation mix, timing/barrier, isolation, and strategy.
4. **Validate before running:** Show scenario completeness, expected outcomes, DB readiness, supported engine behavior, and destructive/reset implications.
5. **Run visibly:** Show actors progressing through a schedule, blocking, committing, aborting, retrying, and changing shared data. Offer run/pause/step/replay controls.
6. **Understand the result:** Show invariant verdict and evidence first, with workload and environment context. Explain the causal schedule in plain language.
7. **Inspect details in place:** Expand transaction SQL/state, locks/waits, deadlock graph, isolation semantics, event trace, DB state, and assertions in contextual panels.
8. **Compare:** Run alternative strategies/configurations and compare correctness and performance on aligned charts/tables.
9. **Save/share/export:** Save scenario and run configuration, copy a reproducible run recipe, and export trace/metrics (CSV initially).

## 5. Experience architecture: integrate “Stats for nerds”

Retire the “Stats for nerds” identity and standalone `/nerds` destination over a staged migration. Do not discard its functionality. Make detailed inspection the **Details / Evidence** layer of the relevant scenario or run.

### Default run view (approachable)

- Scenario name and question; DBMS/engine and run configuration.
- One clear verdict: invariant held, invariant violated, or inconclusive/error.
- Visual schedule/timeline with transaction lanes and meaningful state changes.
- Key metrics: completed, rejected/aborted, retries, deadlocks, violations, p50/p95, throughput.
- A concise “why this happened” explanation tied to trace events.
- Suggested next comparison (e.g., change isolation or add a lock).

### Contextual technical inspection (progressive disclosure)

Place advanced evidence behind tabs, side panels, or expandable sections attached to a scenario/run. Preserve deep links and allow expert users to keep details open. Map current tools as follows:

| Existing `/nerds` capability | Target location |
|---|---|
| Checks | Run verdict and invariant panel; show individual assertions and history |
| Lab | Scenario setup and run controls/results |
| Stepper | Schedule view with pause/step controls and lock/wait inspector |
| Index | Scenario-specific performance diagnosis / DB internals inspector |
| Theory | Inline concept explanations linked from a trace or result |
| Action trace | Run event timeline and replay |
| Live state | Current scenario state and transaction snapshot |
| Audit log | Run history / event log |
| Experiment runs | Scenario run comparison and saved history |
| Database | Environment and schema inspector, scoped to selected scenario |

The interface should use progressive disclosure rather than a “friendly UI versus nerd page” split. Always label what is observed directly from the DBMS, what is derived by DataSim, and what is a conceptual visualization.

### Navigation and naming direction

Replace current music-specific grouping with a workbench structure such as:

- **Home** — recent work, guided concepts, scenario templates.
- **Scenarios** — browse/create scenario definitions.
- **Runs** — saved and recent executions, filters and comparisons.
- **Concepts** — optional learning/reference index, linked contextually from runs.

Within a scenario, the main sections can be **Build**, **Run**, **Results**, and **Details**. Keep a compact expert toggle or remembered “show technical details” preference, not a separate expert product destination. Remove “Nerds” from public labels; retain compatibility redirects during migration.

## 6. Reliable simulation and evidence model

Reliability means repeatable setup, explicit semantics, observable execution, and honest conclusions. A visually plausible animation is not evidence of a database outcome.

### Run modes must be explicit

1. **Live DBMS run:** Operations are executed against the configured local DBMS; SQL/engine events and final checks are direct evidence. Record engine/version and supported observability.
2. **Deterministic schedule run:** A curated schedule is executed step-by-step against the DBMS, as with the existing transaction stepper. User controls order, pause, resume, and replay.
3. **Conceptual simulation:** A model illustrates a behavior without claiming to be a live database observation. Label as modeled and identify assumptions.

### Reproducibility envelope

Every saved run should capture:

- Immutable scenario revision/hash, operation definitions, invariant/check definition, and data fixture revision.
- DBMS product/version, storage engine, schema migration version, isolation level, relevant configuration, and connection/pool limits.
- Strategy implementation/version and retry policy; actor count, trial count, timing/barrier model, seed, and run mode.
- Start/end timestamps and environment metadata needed to interpret timing; disclose warm/cold state where known.
- Per-trial outcomes and aggregate statistic method (including percentile definition); raw trace or a documented retention policy.
- Warnings for unsupported lock inspection, DB capability mismatch, run error, or incomplete trials.

Do not present a zero-violation result as proof of universal correctness. Distinguish “no violation observed in N trials” from a proof or invariant enforced by a declarative constraint. Show sample size and failed/incomplete trials.

### Scenario/run contract

Define a versioned, validated scenario schema with:

- `id`, `name`, `description`, `conceptTags`, `revision`.
- `entities` and fixture state; domain-neutral keys and values.
- `actors` and transaction/operation templates with typed parameters.
- `invariants` as human description plus executable postcondition (and optional per-step assertion).
- `execution` mode, concurrency schedule/barrier, seed, trials, retry policy.
- `strategies` supported for this scenario; `expectedOutcomes` as explanatory hypotheses, not hard-coded verdicts.
- `visualization` hints that map generic events to visual glyphs without defining engine semantics.

The first generalization should use a curated operation DSL or typed operation registry. Avoid executing arbitrary imported SQL in the browser or accepting unvalidated scenario code. The DB execution adapter owns parameterization, transaction lifecycle, safety limits, cleanup, and event capture.

## 7. Target technical structure

Introduce these boundaries incrementally; this is a target shape, not a demand to reorganize every file in one release:

```text
db/
  migrations/                 Versioned schema changes and fixtures
  schema.sql                  Current local demo schema during transition
server/src/
  core/
    scenario/                 Versioned scenario schema, validation, registry
    run/                      Run lifecycle, reproducibility envelope, events
    invariant/                Invariant definitions and evaluators
    execution/                 Scheduler, barriers, retries, cleanup contracts
  adapters/
    dbms/mysql/                MySQL transaction/lock/metadata implementation
    persistence/               Scenario/run/result repositories
  strategies/                 Generic strategy interface + DB-specific strategies
  scenarios/
    catalog/                  Curated scenario definitions and fixtures
    playback/                 Existing playback scenario as one catalog entry
  lab/                         Transition area; move reusable engines behind core interfaces
  routes/                      Scenario, run, trace, comparison, health APIs
web/src/
  app/                          Router, providers, app shell
  features/
    scenarios/                  Catalog, builder, templates
    runs/                       Run setup, timeline, result, compare, trace
    inspectors/                 Locks, transactions, DB state, assertions
    concepts/                    Contextual educational content
  components/
    visualization/              Generic schedule/timeline/graph primitives
    shell/                       Product navigation, workspace context
  lib/                           API clients, typed events, shared UI state
docs/
  PRODUCT_PLAN.md                This product/implementation plan
  architecture/                  Scenario contract, execution modes, evidence model
  scenarios/                     Scenario authoring guides and scenario notes
  implementation/                Delivery slices and migration checklist
```

### Architectural rules

- Scenario/domain code defines fixtures, operations, and invariants; it must not own scheduler, generic trace, or generic visualization mechanics.
- Generic run events should be typed and stable (`transaction.started`, `read.completed`, `lock.wait.started`, `transaction.committed`, `transaction.aborted`, `invariant.evaluated`). Include scenario-specific payloads only as namespaced optional data.
- DBMS-specific observation belongs in adapters. Missing observability must degrade gracefully and be displayed, not silently fabricated.
- Visualizations consume normalized run events and snapshots; they do not infer database truth from animation timing.
- Strategies declare capabilities/limitations and compatible scenario forms; UI filters unsupported combinations before launch.
- Preserve small isolated transactions, parameterized SQL, lock-order rules, publish-after-commit behavior, and cleanup guarantees already established by the current system.

## 8. Implementation roadmap

Work in reviewable increments. Each phase has a user-visible outcome and an acceptance gate; adjust phase boundaries after an architecture spike if needed.

### Phase 0 — Inventory, product vocabulary, and acceptance baseline

**Work**

- Map current routes, nav labels, domain coupling in schema/seed/server/web, and docs. Record playback-specific behavior that must be isolated from the generic editor and execution core.
- Define the scenario/run vocabulary, the three run modes, and the evidence labels.
- Decide whether initial scope is MySQL-only (recommended, matching current code) and document version/capability support.
- Capture current functional baseline and route compatibility requirements; do not refactor internals yet.

**Acceptance**

- Every current capability has a target destination and preservation decision.
- Team can distinguish a generic engine capability from a playback scenario assumption.

### Phase 1 — Product language and navigation shell

**Work**

- Rewrite README overview, quick summary, home page, sidebar, page titles, and generic docs to describe a DBMS concurrency workbench.
- Replace “Music scenario,” “Stress test,” “Simulation,” and “Stats for nerds” as top-level product framing with Scenarios, Runs, and contextual Details vocabulary.
- Remove playback from the primary scenario catalog and global navigation; leave current routes/code isolated during migration if needed for compatibility.
- Add redirects/aliases from `/nerds`, `/stress`, and legacy routes to the corresponding new product destinations. Preserve query links where practical.
- Add a starter scenario catalog with concept-first entries; mark unimplemented templates as planned, not clickable promises.

**Acceptance**

- A new user can state what DataSim does without learning about music.
- No music-specific phrase appears in global navigation, home hero, generic empty states, or generic technical copy.
- Existing bookmarks do not become dead ends.

### Phase 2 — Scenario contract and domain-neutral run events

**Work**

- Define and validate a versioned ScenarioDefinition and RunConfiguration.
- Normalize current lab/stepper outputs into typed run event, trace, snapshot, metric, and invariant result contracts.
- Keep legacy execution behind an adapter only where needed to preserve existing run/result data; do not make playback the reference shape of the generic scenario model.
- Separate scenario fixtures/operations from run orchestration. Add capability validation for strategy, isolation, engine, and execution mode.
- Include seed, scenario revision, environment, trial count, timing method, and incomplete/error state in results.

**Acceptance**

- Existing playback scenario can run through the contract without changing its correctness semantics.
- A second small scenario can be represented without adding playback-specific branches to generic scheduler/result code.
- Event playback and persisted result decoding handle unknown optional fields safely.

### Phase 3 — One general scenario proves the abstraction

**Work**

- Implement an inventory/seat-reservation/bank-transfer scenario chosen to cover a different entity shape and invariant than playback. Recommended first: inventory reservation (`available >= 0`), then bank transfer for multi-row lock ordering.
- Provide a curated fixture, two or more transaction templates, and a clear expected anomaly/control.
- Reuse schedule runner, run event contract, invariant evaluation, metrics, persistence, and trace UI.
- Add scenario-specific explanations while keeping generic terms generic.

**Acceptance**

- The second scenario demonstrates at least one race, one safe strategy, a final invariant check, and a replayable trace.
- No duplicate engine/scheduler or copied playback-only UI is introduced.

### Phase 4 — Unified scenario workspace and live simulation UI

**Work**

- Create scenario catalog and scenario overview, with “Explore example” and “Build run” entry points.
- Build a guided setup: choose scenario, invariant, actors/workload, strategy/isolation, execution mode, trials, and advanced options.
- Consolidate current stress-story and simulation controls into a shared run experience. Preserve a real-time crowd mode as a workload profile rather than the only product metaphor.
- Provide run, pause, step, resume, cancel, replay, and reset controls with accessible status and keyboard support.
- Show a neutral visual model of entities and actor actions; use domain-specific art only as a scenario skin.

**Acceptance**

- A first-time user can launch a valid default run without configuring technical parameters.
- An expert can inspect and set supported advanced options.
- UI events align with actual server run events, and cancellation/cleanup has an explicit final state.

### Phase 5 — Results and contextual evidence (retire standalone Nerds page)

**Work**

- Make the results overview the default post-run experience: verdict, explanation, metrics, sample size, and caveats.
- Move all ten `/nerds` capabilities into contextual Details/Evidence panels and scenario/run history as mapped above.
- Reuse one trace and selection model so clicking a timeline event opens matching SQL, transaction, lock, and invariant context.
- Add accessible lock/wait graph and deadlock explanation; offer a table/list alternative to graph-only information.
- Remove “nerds” naming from public UI after redirects and links are migrated.

**Acceptance**

- A learner can understand a result without opening technical details; an expert can reach every currently available inspection feature from the relevant run.
- Result claims link to their supporting trace/check/DBMS observation.
- Legacy `/nerds` routes redirect to Runs/Details and no feature is silently dropped.

### Phase 6 — Comparison, run history, and export

**Work**

- Add saved scenarios, run history, filters, and comparison by scenario revision and compatible configuration.
- Compare correctness first, then latency/throughput/retries/aborts/deadlocks, with trial distribution and confidence/variability context as appropriate.
- Export reproducibility recipe, trace, and CSV results; include enough metadata to interpret data outside the app.
- Mark comparisons invalid or partially comparable when engine, scenario revision, timing method, or workload differs materially.

**Acceptance**

- Users can compare at least two strategies on the same scenario/configuration and see both aggregate and per-trial evidence.
- Export includes configuration, environment, and limitation metadata.

### Phase 7 — Reliability, safety, and capability expansion

**Work**

- Add run lifecycle safeguards: bounded actors/trials/timeouts, cancellation, transaction cleanup, idempotent launch, and visible partial failures.
- Add schema migration/versioning and fixture isolation so concurrent runs cannot corrupt one another or demo data.
- Add deterministic schedule fixtures for known anomalies; retain real-DBMS confirmation where supported.
- Measure run overhead and clearly separate simulator timing, application orchestration latency, and database operation latency.
- Expand DBMS adapters only after the capability/evidence contract can label differences accurately.

**Acceptance**

- Interrupted/failed runs leave no open transactions or ambiguous “passed” result.
- Repeated seeded deterministic schedules reproduce event ordering and verdict.
- Capability gaps appear as explicit unavailable evidence, not guessed locks or deadlocks.

### Phase 8 — Deprecation and cleanup

**Work**

- Move implementation out of legacy `lab/sim` and playback-centric route/page names as boundaries prove stable.
- Keep any retained playback demo isolated and optional; remove it from generic navigation, templates, and docs that define the product's core workflow.
- Remove legacy aliases only after a deliberate compatibility window and update all links and scripts.
- Reconcile README, proposal documents, folder map, docs index, and product naming.

**Acceptance**

- Generic core can run user-created and templated scenarios without depending on playback entities.
- No generic architecture/API/UX depends on music-specific entity naming.

## 9. Current repository mapping and likely change points

| Area | Current location | Planned direction |
|---|---|---|
| Product overview | `README.md` | Rewrite as general product overview; remove playback from primary workflow; link this plan |
| Current implementation plan | `docs/PLAN.md` | Preserve as historical/implementation spec for original MVP; link from scenario documentation and label its scope |
| Concurrency and measured results | `docs/concurrency.md`, `docs/experiments.md`, `docs/results/` | Keep evidence, label scenario and environment; add generic methodology docs |
| Home/nav/routes | `web/src/pages/HomePage.tsx`, `web/src/components/shell/nav.ts`, `web/src/App.tsx` | Workspace/template/run-first shell, legacy redirects, no featured playback destination |
| Technical inspector | `web/src/pages/NerdsPage.tsx`, `web/src/components/nerds/` | Move to run/scenario feature panels, contextual entry points, preserve each capability |
| Stress and crowd UX | `web/src/pages/StressTestPage.tsx`, `web/src/pages/stress/`, `web/src/components/sim/` | Shared run setup/results; generic visualization primitives and domain skins |
| Scenario-coupled backend | `server/src/lab/`, `server/src/services/playback.ts`, `server/src/routes/` | Contract adapters first; isolate playback execution; migrate reusable runner/metrics/persistence to core packages |
| Stepper | `server/src/lab/stepper/`, `web/src/components/nerds/StepperTab.tsx` | Promote to deterministic schedule/run feature, keep live MySQL observation explicit |
| DB schema/fixtures | `db/schema.sql`, `db/seed.sql` | Versioned migrations/isolated fixture schemas; retain playback tables for example |
| Test suites | `server/test/`, `web/src/**/*.test.ts` | Add contract and cross-scenario coverage alongside current regression coverage |

## 10. Product design principles and gaps to exploit

- **Make the invisible visible:** show reads/writes, lock acquisition, waits, commits, aborts, retries, and invariant checks on a coherent timeline.
- **Teach by comparison:** pair a failing schedule and a corrected strategy; preserve the same scenario so the causal change is clear.
- **Let users start with intent:** support plain-language concepts and presets before exposing isolation-level and lock details.
- **Connect abstractions to evidence:** each explanation can point to trace entries, SQL, lock records, or invariant evaluation.
- **Offer multiple levels of control:** guided defaults, a visual builder, then advanced configuration; expert detail should not force expert terminology on everyone.
- **Represent uncertainty:** show trial count, variance/distribution, incomplete work, and run mode next to the verdict.
- **Support exploration safely:** visibly distinguish disposable lab data from durable user work; bound workload settings and make reset scope clear.
- **Use scenario skins sparingly:** domain-specific visuals can aid comprehension but generic transaction and evidence language must remain consistent.
- **Make accessibility part of simulation control:** keyboard-operable timeline, reduced motion, readable status announcements, color-independent lock/wait states, and table alternatives for graphs.

## 11. Success measures

Track these as product acceptance measures, not vanity analytics:

- A first-time user can identify the invariant and explain the observed result after one guided run.
- A user can move from a concept template to a completed run with no setup errors and can find evidence for the verdict.
- At least two structurally different scenarios use the same core run, trace, result, and comparison components.
- Every result reports its run mode, scenario revision, engine/configuration, sample size, and error/incomplete state.
- Every current Nerds tool has a contextual home and remains reachable by deep link or migrated route.
- Deterministic teaching schedules reproduce expected outcomes; probabilistic races report trials and never overstate certainty.
- Accessibility review confirms keyboard use and non-color-only state communication for core run controls and results.

## 12. Open decisions for product review

These are intentionally surfaced for a later decision; the recommended default keeps delivery grounded in the existing MVP:

1. **First second scenario:** inventory reservation (recommended for a simple invariant) or bank transfer (recommended for multi-row deadlocks).
2. **Scenario authoring:** curated visual builder first (recommended), then a constrained JSON/DSL import/export format; arbitrary SQL authoring is a later advanced feature.
3. **Initial DBMS scope:** MySQL/InnoDB only (recommended), while designing an adapter seam for future engines.
4. **Persistence:** local workspace and saved runs first, with export/import; collaboration and cloud execution are separate future scopes.
5. **Technical feature presentation:** contextual Details by default, with a persistent expert-detail preference for users who want dense information.

## 13. Definition of done for the general-purpose product transition

The transition is complete when a user can select at least two domain-distinct scenarios, configure and execute reproducible concurrency runs, inspect a synchronized visual schedule and real evidence, compare strategies with correctly qualified results, and access technical details in context. Playback can remain in the catalog, but removing it must not break the generic product. Global product language, routes, and architecture must describe concurrency testing rather than any one demo domain.
