# DataSim v2 — Autonomous Build Brief

You are Claude Code acting as tech lead and the whole team. Build DataSim v2 from this brief end to end, **without asking the user anything**. The user is asleep and will demo this to their DBMS professor tomorrow. Read the whole brief before you start. Whenever your context is compacted or the session restarts, re-read this file and `.datasim-v2/PROGRESS.md` before doing anything else.

```
HARD_STOP: 2026-10-13 07:30 Asia/Kolkata      <- user may edit this line
FEATURE_FREEZE: HARD_STOP minus 2h            (no new features after this, only QA/polish/docs)
```

---

## 0. Operating rules

1. **Fully autonomous.** Never ask questions or wait for confirmation. When something is ambiguous, choose the option that makes the demo stronger *and* more honest. Log every non-trivial decision as one line in `.datasim-v2/DECISIONS.md`.
2. **State files are your memory.** In P0 create `.datasim-v2/PLAN.md`, `.datasim-v2/PROGRESS.md` (checklist: item, status, last green commit) and `.datasim-v2/DECISIONS.md`. Update PROGRESS after every milestone.
3. **Git.** Tag the current main locally as `v1-friend` before changing anything. Work on a new branch `v2`. Commit after every green gate (conventional commit messages). Never force-push, never rewrite or commit to `main`, never delete branches or tags. Try `git push -u origin v2` at milestones; if it fails or prompts, keep working locally and note it in the morning report.
4. **Always demoable.** From the P2 gate onward, every commit on `v2` must start with one command and run the flagship demo. If a feature isn't green by its time box, revert it or hide it behind a flag that is off, and move on. Never leave the branch broken.
5. **Time.** Check `TZ=Asia/Kolkata date` at every phase boundary. At FEATURE_FREEZE stop starting features. At HARD_STOP minus 20 min, finish `MORNING_REPORT.md`, commit, and stop.
6. **Quality over quantity.** A smaller set that looks and works like a shipped product beats a big half-working one. Cut Tier 3 first, then Tier 2.
7. **Honesty.** Never fake a measurement. Every number shown carries a provenance tag: `MEASURED` (observed from MySQL or the real request path), `EMULATED` (an injected delay or modeled component that really ran in the request path), `PROJECTED` (a math model fitted to measured data). No placeholder data, no `Math.random()` charts, no "coming soon" items anywhere in the UI.
8. **Environment.** P0 checks `docker info` and `node -v` (need ≥ 20). If Docker is unavailable, keep building and testing everything that doesn't need it and put the blocker at the top of `MORNING_REPORT.md`. You may reset the local Docker volume (`npm run db:reset`); it only holds dev data.
9. **Cross-platform.** The user may be on Windows. All npm scripts must be Node/TS (run with `tsx`), never bash-only.
10. **Dependencies.** The lead installs every planned dependency in P1. Subagents never edit `package.json` or the lockfile; if they need a package they ask the lead.

---

## 1. The product

**One-liner:** DataSim is Cisco Packet Tracer for database engineers. Drag components onto a canvas, design the schema visually, describe the workload, and run it against a real MySQL 8.4 / InnoDB server to see latency, throughput, contention, anomalies and where the design breaks, before building the real system.

The demo must answer these questions convincingly:

- Will this schema and topology handle N concurrent users? At what load does it break? (capacity test + SLO verdict)
- What latency does each transaction see (p50/p95/p99), and where is the time spent (app queue, network, connection wait, DB execution)?
- Is the data still correct under concurrency? (SQL invariants; lost update, overbooking, deadlocks)
- What changes if I add an index, a cache, more app servers, a bigger pool, a different isolation level or a different concurrency-control strategy? (fork the design, re-run, compare)
- Which statements are slow and why? (performance_schema digests + EXPLAIN + advisor)

Quality bar: it should look like a professional dev tool (Linear / Vercel / Argo CD level), dark, sleek and minimal. Not a student project, not playful.

---

## 2. Non-negotiables

- **Real tables.** The user's schema becomes real DDL (`CREATE TABLE` with PK, FK, UNIQUE, INDEX, CHECK, generated columns) in a sandbox MySQL database, seeded with generated data. The workload is real parameterized SQL transactions on real connections. This explicitly replaces the current runner, which stores user rows as JSON blobs in one `scenario_run_state` table (no real indexes, FKs or query plans).
- **Review 1 continuity.** Review 1 is already submitted and cannot change (Appendix A). Keep: MySQL 8.4/InnoDB as the primary engine; Node/TypeScript/Express/React/Socket.IO; Redis 7 as an optional component; the strategy list; Transaction Stepper; Concurrency Lab; a simulation control room with virtual users; lock and wait-for views; invariant checks; persisted experiments; CSV/Markdown export. Use those names in the UI where natural. Review 1 itself pitches "a focused learning simulator such as Cisco Packet Tracer", so this build is a return to Review 1, not a deviation.
- **Local and offline.** No external APIs, no CDNs, fonts bundled. Works on Windows/macOS/Linux with Docker Desktop.
- **One command.** `npm run demo` = ensure `.env` → docker up (wait healthy) → migrations → seed templates → start server + web → print the URL. Plus `npm run doctor` (preflight: Docker, ports, MySQL version, performance_schema ON, Redis reachable, restricted user exists).

---

## 3. Current repo: what to keep and what to retire

Before deleting anything, map the dependency graph and log the decisions.

**Keep (reuse; refactor as needed):**
- `docker-compose.yml` (MySQL 8.4 with performance_schema ON, `max-connections=300`; Redis 7), `.env.example`.
- `server/src/db/*`: pools, `withTx`/retry helpers, error classifiers (`isDeadlock`, `isLockWaitTimeout`), migrations runner, named lock, redis client.
- `server/src/strategies/*` and `server/src/lab/{raceRunner,lostUpdate,indexExperiment,persist,stats,invariant,labLock}.ts` + `routes/lab.ts`. These back the **Strategy Benchmark** tab of the Concurrency Lab (reskinned UI). They implement all 8 Review 1 strategies (NAIVE, TXN_RR, SERIALIZABLE, PESSIMISTIC, OPTIMISTIC, CONSTRAINT, TRIGGER, REDIS_LEASE) with real benchmarks, so reuse them as-is.
- `server/src/lab/stepper/*` + `routes/stepper.ts`: the Transaction Stepper, including live lock inspection from `performance_schema.data_locks` / `data_lock_waits`. Reskin the UI.
- Legacy tables in `db/schema.sql` (account, device, song, playback_session, playback_event, experiment_run), because the lab and stepper depend on them. Do not rename them. In the UI, label them with Review 1 vocabulary (accounts, clients, allocations, events) and add a small footnote mapping the legacy table names.
- Test infrastructure (vitest, supertest, `server/test/helpers.ts`).
- `docs/results/*.csv` (historical benchmark results).

**Retire (delete code, routes, UI and their tests; leave `db/migrations/001_scenario_workspaces.sql` untouched so existing volumes still migrate):**
- The generic scenario workbench: `server/src/core/scenario/*`, `routes/scenarios.ts`, `web/src/components/workbench/*`, the old `WorkspacesPage`, `WorkspacePage` and `RunsPage`.
- All playful and music UI: `Mascot`, `home/*`, `watermelon/*`, `story/*`, `pages/stress/*`, `components/sim/*` UI, `device/*`, `DevicePage`, `devices/*`, `RaceTrack`, `Verdict`, `DevicesTour`, `brand/WorkspaceIntro` (reload animation), `geo/*`, the Fredoka font, the coral/"watermelon" palette, `animejs`. Port any logic you need from `nerds/*` into new components, then delete `nerds/*`.
- Server routes for accounts/playback/sim: keep them only if the lab or stepper depends on them; otherwise remove. The backend sim engine can stay if its tests are cheap to keep, but it gets no UI route.
- Docs describing retired features: move to `docs/archive/` (keep the history, don't delete).

---

## 4. Architecture

### 4.1 Execution model

Explain this exact model in `docs/ARCHITECTURE.md` and in an in-app "How measurements work" popover.

A **design** = topology graph + schema model + workload model + run settings.

A **run**:
1. Validate the design (topology rules, schema, SQL static checks, references).
2. **Provision the sandbox:** database `dsim_<projectShortId>` (drop + create), apply the generated DDL as admin, seed deterministically (seeded PRNG) with batched multi-row INSERTs, stream progress.
3. **Warm up** (default 3 s), then measure.
4. **Virtual users (VUs)** run closed-loop: pick a transaction by weight → generate params → send the request along the topology path: Users →(link latency)→ [Load balancer] →(link)→ App server (bounded in-flight workers with a queue; per-request processing time) →(link)→ [Cache] → Database (real `mysql2` pool connection, real transaction at the configured isolation, real retries) → response → think time.
5. **Sample every 1 s:** app-side latency percentiles, TPS, errors by class, retries, queue depths, pool usage; DB-side via an admin connection: `SHOW GLOBAL STATUS` deltas (`Threads_running`, `Innodb_row_lock_waits`, `Innodb_row_lock_time`, `Innodb_buffer_pool_read_requests`/`_reads`, `Com_*`); `performance_schema.data_lock_waits` snapshots (≤ 2 Hz) for the wait-for graph. Count deadlocks from errno 1213 per transaction.
6. **After the run:** execute the SQL invariants; collect `performance_schema.events_statements_summary_by_digest` deltas filtered by `SCHEMA_NAME`; run `EXPLAIN FORMAT=JSON` for every statement template with sample params; compute findings and the SLO verdict; persist everything relationally; emit the report.

Provenance:
- **MEASURED:** DB execution time, lock waits, deadlocks, rows examined, invariants, end-to-end wall-clock latency (which includes emulated delays and real queueing), cache hit ratio.
- **EMULATED:** link latency, app processing time, load balancer. They are implemented as real awaits in the request path, so they really hold VUs and really create queueing.
- **Cache:** real Redis (cache-aside on transactions marked cacheable; key = template + params; TTL configurable). Hit ratio is measured. If Redis isn't reachable at run start, validation blocks the run with a clear message (never silently emulate).
- **PROJECTED:** capacity beyond the tested load (USL fit, §4.5).

Measure each request's phases with `process.hrtime.bigint()` timestamps (queue wait, link, app, pool acquire, DB execution), so the "where the time went" breakdown is real.

### 4.2 Component palette (canvas nodes)

**Tier 1:**
- **Users** (`users`): VUs (1–500), think time (ms, distribution), load pattern `constant | ramp | spike | step`, duration (s). The transaction mix lives here; double-click opens the Workload Editor.
- **Load balancer** (`lb`): `round-robin | least-connections`.
- **App server** (`app`): instances (1–8), workers per instance (max in-flight), processing time (mean, jitter ms), DB connection pool size per instance (a real `mysql2` pool), concurrency-control strategy (variant selector, §4.4), retry policy (max retries, backoff) for deadlock, lock-wait timeout and CAS failure.
- **Cache** (`redis`): TTL, which read-only transactions are cacheable.
- **Database** (`mysql`): engine label "MySQL 8.4 · InnoDB", isolation (READ UNCOMMITTED / READ COMMITTED / REPEATABLE READ / SERIALIZABLE), `innodb_lock_wait_timeout` (session, default 3 s), `max_execution_time`. Schema (double-click → Schema Designer), seed spec, invariants.
- **Edges** are links with latency (ms) + jitter.
- **Connection rules** (enforced while dragging, Packet Tracer feel; invalid drops are rejected with a toast saying why): `users → lb | app`, `lb → app`, `app → redis | mysql`; `redis` and `mysql` have no outgoing edges; Tier 1 allows exactly one `mysql` and needs at least one `app`. Total pool connections across apps ≤ 250.

**Tier 3** (only if everything else is green with > 2 h before freeze): real read replica (second MySQL container with GTID replication; route read-only transactions; measure `Seconds_Behind_Source`); PostgreSQL 16 engine adapter. Otherwise omit them entirely; never show disabled placeholders.

### 4.3 Schema model (zod, in the shared package)

- **Tables and columns.** Types: TINYINT, SMALLINT, INT, BIGINT, DECIMAL(p,s), FLOAT, DOUBLE, BOOLEAN, CHAR(n), VARCHAR(n), TEXT, DATE, DATETIME(3), TIMESTAMP(3), ENUM(...), JSON. Column flags: nullable, default, autoIncrement. PK (composite allowed), multi-column UNIQUE constraints, multi-column indexes (named), multi-column FKs (ON DELETE/UPDATE), CHECK expressions (validated by MySQL at apply time; map errors back to the table in the UI), STORED generated columns. Identifiers match `^[a-z][a-z0-9_]{0,63}$` and are always backtick-quoted.
- **DDL generator:** deterministic, tables ordered by FK dependency, previewable in the UI, downloadable as `.sql`.
- **Seed spec per table:** row count plus a generator per column: `sequence`, `uniformInt`, `normalInt`, `zipf(s)`, `decimalRange`, `pickList` (weighted), `personName`, `email` (derived), `pattern` (e.g. `24BCE####`), `dateRange`, `constant`, `fkRef` (uniform or zipf over parent keys), and a limited `expression` over other columns. Use a seeded PRNG (mulberry32/sfc32), never `Math.random`. Batch 1,000 rows per INSERT and emit progress. Target: 100k rows in under 20 s on a laptop.
- **Import (Tier 2):** paste `CREATE TABLE` DDL → apply in a scratch schema as admin → introspect `information_schema` → schema model. MySQL does the parsing.
- **Normalization assistant (Tier 2):** per table or per "universal relation" with user-entered FDs → attribute closure, candidate keys, prime attributes, highest normal form (1NF–BCNF) with the violating FDs, BCNF decomposition with a lossless-join check, 3NF synthesis from a minimal cover, and "Apply decomposition" that creates tables + FKs. A pure TS module with unit tests built from textbook examples.

### 4.4 Workload model

A **transaction template** has:
- `name`, `weight`, `readOnly`, `cacheable`, `description`.
- `params`: name → generator (the seed generators, plus `fromTable(table, column, dist)` sampling keys loaded once at run start).
- `variants`: map of strategy name → steps (at least `default`). Strategy names shared across templates: `naive`, `pessimistic`, `optimistic`, `atomic`, `serializable` (forces SERIALIZABLE for that transaction). The App server's strategy selector picks the variant; templates without that variant fall back to `default`.
- A **step**: `{ sql, bindAs?, guard?, expectAffected? }`.
  - `sql` uses `mysql2` named placeholders (`:param`, and `:$bind.col` for bound values).
  - `bindAs` saves the first result row as `$name`.
  - `guard: { left, op (= != < <= > >=), right, onFail: 'reject' }` is a business rejection: ROLLBACK, counted as REJECTED, not ERROR.
  - `expectAffected: { op, value, onFail: 'reject' | 'retry' }` (e.g. an optimistic CAS that affects 0 rows → retry).

**Execution:** `SET TRANSACTION ISOLATION LEVEL …` → `START TRANSACTION` → steps → `COMMIT`. Classify errors: deadlock 1213, lock-wait timeout 1205, duplicate key 1062 (→ reject), CHECK violated 3819 (→ reject), FK 1452, query timeout 3024, other. Retries follow the App server's policy.

**SQL safety:**
- Workload SQL runs as a restricted MySQL user `dsim_runner` with only `SELECT, INSERT, UPDATE, DELETE ON \`dsim\_%\`.*`.
- Statements must start with SELECT / INSERT / UPDATE / DELETE / WITH; multi-statements are rejected (the driver default); values are always bound.
- DDL is only ever generated by DataSim and executed by the admin connection.

**Test once:** in the Workload Editor, run one instance of a template on the provisioned sandbox inside a transaction, then ROLLBACK. Show each step's rows, affected count and time. This is great for authoring and for the viva.

**Invariants:** name, description, and SQL returning a single number `violations` (0 = pass). Checked after the run; Tier 2: also sampled every 5 s during the run.

### 4.5 Analysis

- **SLO** per project: p95 target in ms (global, with optional per-transaction targets) and a max error-rate %. Verdict PASS/FAIL with the reason.
- **Bottleneck detection** per node: app (queue wait share, worker utilization), pool (connection wait time), DB (lock-wait share, Threads_running, rows examined per transaction), cache (hit ratio), network (emulated share). Highlight the bottleneck node on the canvas (amber/red border + a "bottleneck" pill) and in the report.
- **"Where the time went":** a stacked bar per transaction (queue / network / app / pool wait / DB execution), from the measured phase timestamps.
- **Advisor findings** (rule-based; each with severity, evidence numbers, statement digest, a 2–3 sentence theory explanation, and a fix):
  - Full table scan (`EXPLAIN` access type ALL with rows ≥ 1,000) → "Add index on table(cols)". One click adds the index to the schema and creates a new revision.
  - FK column without an index.
  - Hot-row contention (lock waits concentrated on one key) → atomic UPDATE, sharded counter or queueing.
  - Deadlocks from inconsistent lock order → ordered locking.
  - Invariant violations under the `naive` strategy → suggest a safe strategy.
  - Pool starvation → bigger pool or more app instances.
  - Low cache hit ratio.
  - SERIALIZABLE throughput cost.
  Explanations reference DBMS theory: lost update, write skew/phantoms, strict 2PL, MVCC, next-key/gap locks, wait-for graph deadlock detection.
- **Capacity test:** step the VUs (default 10, 25, 50, 100, 200 × 10 s each). Record TPS, p95 and error rate per step. Detect the knee (the first step where TPS gains < 10% while p95 grows > 50%, or the SLO breaks). Fit the Universal Scalability Law `X(N) = λN / (1 + σ(N−1) + κN(N−1))` by bounded least squares (σ, κ ≥ 0), hand-written with no dependency. Report the peak `N* = √((1−σ)/κ)`, `X_max` and R². Plot measured points plus the fitted curve, dashed as PROJECTED beyond the largest tested N. Add a Little's-law sanity check (`N ≈ X·(R+Z)`). Report sentence format: *"Sustains ~1,240 tps at p95 ≤ 200 ms up to ~140 VUs; projected peak ~1,410 tps at ~180 VUs (USL, R² 0.97)."*
- **Compare:** select 2–4 runs (same project, any revisions) → side-by-side metrics with deltas (green better / red worse), overlaid TPS and p95 charts, invariant results, findings diff, and a design diff (what changed between revisions: nodes, config, schema, indexes).
- **Compare strategies (Tier 2):** one click runs the same design once per defined strategy variant with the same seed and a short duration, then opens Compare.
- **Export:** report as Markdown + CSV (samples, transaction stats), DDL `.sql`, canvas PNG (`html-to-image`).

### 4.6 Persistence (DataSim's own DB `datasim`, migration 002+)

Design this in 3NF/BCNF and document the FDs; the examiner may ask. Suggested tables (refine as needed):

- `project(project_id CHAR(36) PK, name, description, template_key NULL, created_at, updated_at, archived_at NULL)`
- `design_revision(project_id FK, revision_no, PK(project_id, revision_no), design_json JSON, content_hash CHAR(64), note, created_at)`. Autosave writes a draft; Save or Run pins an immutable revision.
- `run(run_id CHAR(36) PK, project_id, revision_no, FK(project_id, revision_no) → design_revision, kind ENUM('LOAD','CAPACITY','STRATEGY_CHILD'), parent_run_id NULL FK → run, status ENUM('QUEUED','PROVISIONING','WARMING','RUNNING','ANALYZING','COMPLETED','FAILED','CANCELLED'), settings_json, strategy, isolation_level, vus, duration_s, seed, mysql_version, started_at, finished_at, txn_total, committed, rejected, errored, retries, deadlocks, lock_timeouts, tps_avg, p50_ms, p95_ms, p99_ms, slo_pass NULL, error_text NULL, INDEX(project_id, started_at))`
- `run_sample(run_id FK, t_s, PK(run_id, t_s), tps, p50_ms, p95_ms, p99_ms, errors, active_vus, app_queue, pool_waiting, threads_running, row_lock_waits, lock_wait_ms, bp_hit_ratio, cache_hit_ratio)`
- `run_txn_stat(run_id, txn_name, PK, count, committed, rejected, errored, retries, deadlocks, p50_ms, p95_ms, p99_ms, mean_ms, queue_ms, net_ms, app_ms, pool_ms, db_ms)`
- `run_statement_stat(run_id, digest CHAR(64), PK, digest_text, txn_name NULL, exec_count, avg_ms, max_ms, rows_examined, rows_sent, rows_affected, no_index_used, lock_time_ms, explain_json NULL)`
- `run_lock_wait(run_id, seq, PK, at_ms, waiting_txn, blocking_txn, table_name, index_name, lock_mode, lock_data)`
- `run_invariant(run_id, invariant_name, PK, sql_text, violations, passed)`
- `run_finding(run_id, finding_no, PK, severity ENUM('HIGH','MEDIUM','LOW','INFO'), kind, title, evidence_json, fix_json NULL)`
- `capacity_point(run_id, step_no, PK, vus, tps, p50_ms, p95_ms, error_rate)` and `capacity_fit(run_id PK, sigma, kappa, lambda, n_peak, x_max, r2)`

Child tables use `ON DELETE CASCADE` from `run`. Justify JSON only for the editor document (versioned, read and written whole); everything queried or compared is relational.

### 4.7 API (REST, zod-validated) + Socket.IO

- `GET|POST /api/projects`, `GET|PATCH /api/projects/:id`, `POST /api/projects/:id/archive`, `POST /api/projects/:id/duplicate` (fork design)
- `GET /api/templates`, `POST /api/templates/:key/instantiate`
- `GET|PUT /api/projects/:id/draft`, `POST /api/projects/:id/revisions`, `GET /api/projects/:id/revisions/:n`
- `POST /api/projects/:id/validate` → `problems[]` with paths (node id, table, column, transaction, step)
- `POST /api/projects/:id/sandbox/provision`, `POST /api/projects/:id/sandbox/test-txn`, `POST /api/projects/:id/sandbox/query` (Tier 2: read-only SELECT console, 200-row cap)
- `POST /api/projects/:id/runs {kind, overrides}`, `GET /api/runs?projectId=`, `GET /api/runs/:id` (full report), `POST /api/runs/:id/cancel`, `GET /api/runs/:id/export.md`, `GET /api/runs/:id/export.csv`
- `POST /api/compare {runIds}`, `POST /api/projects/:id/compare-strategies`
- `POST /api/schema/ddl` (model → DDL), `POST /api/schema/import` (DDL → model), `POST /api/normalize`
- `GET /api/health` (MySQL version, performance_schema ON, Redis OK, restricted user OK)
- Keep `/api/lab/*` and `/api/stepper/*`.
- Socket.IO room `run:<id>` with events `run:status`, `run:provision-progress`, `run:sample` (1 Hz), `run:locks` (≤ 2 Hz), `run:finished`.
- One active run at a time (global named lock); reject a second run with a clear message.

---

## 5. UI / UX

### 5.1 Design language

Reference: the user shared a screenshot of an Argo CD application resource tree. If `docs/design/reference.png` exists, look at it. Replicate the feel, not the brand: a dark near-black canvas, compact rectangular node cards, a small icon tile on the left of each card with a lowercase type label under it (like `svc`, `pod`), a name, tiny status icons, a kebab menu top-right, small rounded pills bottom-right, and thin dashed orthogonal connectors.

- **Theme:** dark-first; light theme via the same tokens with a toggle in settings. App background `#0b0b0c`; canvas with a subtle 1px dot grid (`#1f1f23`). Surfaces `#141416` / `#18181b`; borders `#26262b`; text `#ededed`, muted `#8b8b93`, faint `#5b5b63`.
- **Color:** one accent, teal (≈ `#2dd4bf`), for selection and primary actions. Status colors: green `#22c55e` (healthy/pass), amber `#f59e0b` (warning/saturating), red `#ef4444` (fail/violation), blue `#60a5fa` (running/info).
- **Type:** Geist for UI and Geist Mono for numbers, SQL and ids, bundled via `@fontsource-variable/*` (fallback: Inter + JetBrains Mono). 13 px base, 12 px secondary. Tabular numerals wherever numbers update.
- **Shape:** radius 8–10 px, 1 px borders, almost no shadows. No gradients, no glassmorphism, no emojis, no mascots, no illustrations, no bento cards. Icons: lucide, 16 px, stroke 1.5.
- **Motion:** 120–200 ms ease-out for panels. The only "showy" animation is request dots flowing along edges during runs, plus number ticking. Respect `prefers-reduced-motion`.
- **Copy:** terse, technical, sentence case. No exclamation marks, no jokes. Example: "Provisioning sandbox · 42,000 / 100,000 rows".
- **Layout:** desktop-first (≥ 1280 px). Under 1024 px, show a simple "Best viewed on a desktop" notice instead of a broken layout.

### 5.2 Canvas node card

- About 240 × 64 px. Left: a 40 px icon tile (muted icon) with the lowercase type label below (`users`, `lb`, `app`, `redis`, `mysql`). Title 13 px medium (truncate + tooltip). Status row: health dot + small state icons (validated, running spinner). Top-right kebab menu (Configure, Duplicate, Delete).
- Bottom-right mono pills. At rest they show key config: `200 VUs`, `2× pool 16`, `RR`, `ttl 30s`. During runs they show live metrics: `812 tps`, `p95 41ms`, `pool 16/16`, `hit 87%`.
- Selected: 1 px accent border + soft accent outline. Bottleneck: amber/red border + a `bottleneck` pill. Handles are small and appear on hover.
- Edges: smoothstep, 1 px dashed `#3f3f46`, with a latency label pill (`2 ms`). During runs, animated dots whose count is proportional to throughput (capped).

### 5.3 Screens

1. **Projects** (`/`): header "Projects" + a "New project" split button (Blank / From template). A row of 4 compact, flat template cards (name, one line, tags like `overbooking · locks · capacity`). Projects table: name, template, last verdict pill, last p95, updated, actions. A one-line empty state with buttons.
2. **Studio** (`/p/:id`):
   - **Top bar:** breadcrumb (Projects / name, rename inline), revision pill (`rev 7 · saved`), Validate (with problem count), **strategy and isolation quick selectors** (they mirror node config; these are the key demo levers), a Run split button (Load test | Capacity test | Compare strategies), SLO chip, overflow menu (Export DDL, Export PNG, Duplicate design).
   - **Left palette:** search, then groups: Traffic (Users, Load balancer), Compute (App server), Data (Cache, Database). Drag onto the canvas or click to add.
   - **Center:** React Flow canvas with a dark minimap, zoom controls, snap to grid, and an auto-layout button (dagre, left to right).
   - **Right inspector** (320 px): compact labeled forms for the selected node or edge (number fields with units, selects, sliders where useful). The DB node shows a summary (tables, rows, indexes) and an "Open schema designer" button; Users shows a workload summary and "Open workload editor".
   - **Bottom panel** (collapsible, resizable): tabs Live · Transactions · Statements · Locks · Invariants · Findings · Log. During a run, Live shows 4 small charts (TPS; p50/p95/p99; errors/retries/deadlocks; DB threads running and lock waits) plus a phase bar (Provisioning → Warm-up → Measuring 12/20 s → Analyzing) and a Cancel button.
   - **Double-click:** DB → Schema Designer (full-screen overlay, Esc closes); Users → Workload Editor overlay; anything else → focus the inspector.
   - **Keyboard:** Delete; Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z (undo/redo via zundo); Ctrl/Cmd+D duplicate; Ctrl/Cmd+Enter run; Ctrl/Cmd+K command palette (Tier 2).
3. **Schema Designer:** an ER canvas (React Flow) with table nodes like a DB diagram tool. Header: table name + row-count pill. One row per column: key icon for PK, link icon for FK, column name, type in muted mono, NN marker. FK edges go column to column with distinct one/many end markers. Toolbar: Add table, Auto layout, Seed data, DDL preview (side panel, read-only CodeMirror, copy + download), Import DDL (T2), Normalize (T2), Validate. Right panel: table editor with an inline-editable column grid (name, type, length, NN, PK, UQ, AI, default), constraints, indexes, FKs, checks, and per-column seed generators with a 5-value sample preview.
4. **Workload Editor:** a left list of transactions (name, weight %, read/write badge, variant count) under a weight-mix bar showing % per transaction. Main area: params table (name, generator, args, sample values), variant tabs (default, naive, pessimistic, …), a steps list with CodeMirror SQL (autocomplete for tables, columns and params) plus bind/guard/expect controls. Right: "Test once" results (per step: rows, affected, ms) and an Explain button. A separate Invariants section (SQL + description + "Check now").
5. **Run report** (`/runs/:id`): a header (project, revision, kind, strategy, isolation, VUs, duration, MySQL version, PASS/FAIL verdict pill against the SLO); a KPI strip (TPS, p50, p95, p99, committed, rejected, errors, deadlocks, invariant violations) with provenance tags; charts; the where-the-time-went bar; a per-transaction table; a statements table (digest, avg, rows examined, no-index flag, EXPLAIN drawer); lock waits with a mini wait-for graph; invariants; findings with "Apply fix → new revision" buttons; and, for capacity runs, measured points + USL curve + knee + the verdict sentence. Export buttons.
6. **Runs** (`/runs`): a table filterable by project, kind and verdict. Select 2–4 → Compare.
7. **Compare** (`/compare?ids=…`): as in §4.5.
8. **Concurrency Lab** (`/lab`): the reskinned legacy Strategy Benchmark (8 strategies × stream-limit / lost-update) and index experiment; results table + chart; one short explanation per strategy.
9. **Transaction Stepper** (`/stepper`): reskinned two-column T1/T2 UI with the real lock table and wait-for graph from performance_schema, using the legacy scenarios. Tier 2: "Step two transactions from this project" using workload templates on the sandbox.
10. **Global:** a slim left icon rail with tooltips (Projects, Runs, Concurrency Lab, Stepper) and a health dot at the bottom (MySQL/Redis status and version; graceful "API offline" state). Toasts bottom-right. Skeleton loaders instead of spinners. Every empty or error state has a one-line explanation and the next action.

---

## 6. Built-in templates

Seed these on startup (idempotent). Each has a schema, seed sizes, a workload with variants, invariants, default topology and an expected demo outcome. Integration tests must prove each outcome (§9). Tune parameters until the outcome happens in 3 consecutive runs.

### T1 — Course Registration Rush (college DB, FFCS-style) — flagship, Tier 1

Schema:
- `department(dept_id INT PK AI, code VARCHAR(8) UQ, name VARCHAR(80))`
- `student(student_id INT PK AI, reg_no CHAR(9) UQ, name VARCHAR(80), dept_id FK, year TINYINT CHECK 1..5, cgpa DECIMAL(4,2) CHECK 0..10)`
- `faculty(faculty_id INT PK AI, name VARCHAR(80), dept_id FK)`
- `course(course_id INT PK AI, code VARCHAR(10) UQ, title VARCHAR(120), credits TINYINT CHECK 1..5, dept_id FK)`
- `section(section_id INT PK AI, course_id FK, faculty_id FK, slot VARCHAR(12), capacity SMALLINT CHECK > 0, enrolled SMALLINT DEFAULT 0 CHECK >= 0, version INT DEFAULT 0, UNIQUE(section_id, course_id))`. Deliberately **no index on `slot`**, so the advisor finds it.
- `enrollment(student_id FK, section_id, course_id, enrolled_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), PK(student_id, section_id), UNIQUE(student_id, course_id), FK(section_id, course_id) → section(section_id, course_id))`. This composite FK is the controlled-redundancy pattern from Review 1 §8.5.

Seed: 12 departments, 20,000 students (`reg_no` like `24BCE0001`), 300 faculty, 400 courses, 1,200 sections (capacity 60–70, enrolled 0), course popularity zipf.

Workload (Users: 200 VUs, spike pattern "registration opens", think time 50–150 ms, 20 s):
- **register** (55%): student uniform, section zipf (s ≈ 1.1).
  - `naive`: `SELECT enrolled, capacity, course_id FROM section WHERE section_id=:sid` → bind `$s`; guard `$s.enrolled < $s.capacity`; INSERT enrollment; `UPDATE section SET enrolled = :$s.enrolled + 1 WHERE section_id = :sid` (stale write → lost update + overbooking).
  - `pessimistic`: the same, but the SELECT is `… FOR UPDATE`.
  - `atomic`: `UPDATE section SET enrolled = enrolled + 1 WHERE section_id = :sid AND enrolled < capacity` → `expectAffected = 1` else reject; then INSERT enrollment.
  - `optimistic`: read with `version`; `UPDATE … SET enrolled = enrolled + 1, version = version + 1 WHERE section_id = :sid AND version = :$s.version AND enrolled < capacity` → 0 rows → retry.
- **search_sections** (35%, read-only, cacheable): sections joined with course and faculty, `WHERE c.dept_id = :dept AND s.slot = :slot ORDER BY seats_left DESC LIMIT 20`.
- **my_timetable** (10%, read-only): the student's enrollments joined with section, course and faculty.

Invariants:
- `no_overbooking` (true seats): `SELECT COUNT(*) FROM section s WHERE (SELECT COUNT(*) FROM enrollment e WHERE e.section_id = s.section_id) > s.capacity`
- `counter_consistent`: `SELECT COUNT(*) FROM section s WHERE s.enrolled <> (SELECT COUNT(*) FROM enrollment e WHERE e.section_id = s.section_id)`

Topology: Students (200 VUs) → LB → App ×2 (32 workers, pool 16, 2 ms) → Redis (TTL 30 s) + MySQL (REPEATABLE READ, lock wait 3 s).

Expected demo: `naive` → violations > 0; `atomic` → 0 violations. The advisor flags a full scan on `section.slot` → Apply fix → re-run → search p95 drops visibly. The capacity test shows a knee and a USL projection.

### T2 — Review 1: Shared Resource Allocation — Tier 1, uses the exact Review 1 entities

Schema:
- `user_account(account_id INT PK AI, username VARCHAR(40) UQ, quota TINYINT CHECK 1..10, conflict_policy ENUM('REJECT','TAKEOVER','ASK'), state_version BIGINT DEFAULT 0, is_lab BOOLEAN DEFAULT FALSE)`
- `client(client_id INT PK AI, account_id FK, client_name VARCHAR(60), client_type ENUM('DESKTOP','MOBILE','TABLET','WEB'), last_seen_at DATETIME(3) NULL, UNIQUE(account_id, client_name), UNIQUE(client_id, account_id))`
- `resource(resource_id INT PK AI, resource_name VARCHAR(80), resource_type VARCHAR(30), capacity INT CHECK >= 0, shared_counter BIGINT DEFAULT 0)`
- `allocation(allocation_id BIGINT PK AI, client_id, account_id, resource_id FK, status ENUM('ACTIVE','RELEASED','EXPIRED','PREEMPTED'), quantity INT DEFAULT 1, started_at DATETIME(3), lease_expires_at DATETIME(3), ended_at DATETIME(3) NULL, strategy VARCHAR(24), active_account_id INT GENERATED ALWAYS AS (IF(status='ACTIVE', account_id, NULL)) STORED, FK(client_id, account_id) → client(client_id, account_id), INDEX(account_id, status, lease_expires_at))`
- `operation_event(event_id BIGINT PK AI, account_id, client_id, allocation_id NULL, event_type ENUM('CLAIM_GRANTED','CLAIM_REJECTED','RELEASED','EXPIRED','PREEMPTED'), state_version BIGINT, client_request_id CHAR(36), created_at DATETIME(3), detail JSON NULL, UNIQUE(client_id, client_request_id))`

Seed: 500 accounts (quota 1–3; a hot subset of lab accounts with quota 1), 2,000 clients, 50 resources.

Workload (150 VUs; accounts zipf so lab accounts are hot):
- **claim** (70%), variants:
  - `naive`: count active allocations, then insert.
  - `serializable`
  - `pessimistic`: lock the `user_account` row `FOR UPDATE`, then count.
  - `optimistic`: `state_version` CAS + retry.
- **release** (20%)
- **bump_counter** (10%): lost-update demo; `naive` read-modify-write vs `atomic`.

Note: the CONSTRAINT strategy is a *schema* change, demonstrated by forking the design and adding `UNIQUE(active_account_id)` (meaningful for quota-1 accounts). The TRIGGER and REDIS_LEASE strategies live in the Concurrency Lab's Strategy Benchmark. State this in the docs: "a strategy can live in the schema, not just the code."

Invariant `within_quota`: `SELECT COUNT(*) FROM (SELECT a.account_id FROM allocation a JOIN user_account u ON u.account_id = a.account_id WHERE a.status = 'ACTIVE' GROUP BY a.account_id, u.quota HAVING COUNT(*) > u.quota) x`.

Topology: Clients (150 VUs) → App (pool 24) → MySQL.

### T3 — Flash Sale Checkout (Tier 2)

`product(product_id, sku UQ, name, price, stock, initial_stock)`, `customer`, `orders`, `order_item(PK(order_id, product_id))`. Hot SKUs via zipf. `checkout` variants `naive` / `atomic`. Invariants: `stock >= 0`, and `initial_stock − stock = SUM(qty sold)`. Teaching point: a `CHECK (stock >= 0)` is itself a constraint strategy. The default design omits it; the advisor/fork adds it, and the naive variant then fails loudly instead of corrupting data.

### T4 — Bank Transfers and Deadlocks (Tier 2)

`account(account_id, holder, balance DECIMAL(14,2) CHECK >= 0)`, `transfer(transfer_id, from_id, to_id, amount, created_at)`, `bank_meta(k PK, v)` seeded with the total. `transfer` variants: `unordered` (lock `from` then `to` → deadlocks) vs `ordered` (lock LEAST id, then GREATEST id → no deadlocks). Plus a read-only `audit_balance` transaction. Invariant: the total balance is conserved. Demo: deadlock count, wait-for graph, and the cost of retries.

---

## 7. Tech stack

- **web, add:** `@xyflow/react`, `zustand` + `zundo`, `@dagrejs/dagre`, `@uiw/react-codemirror` + `@codemirror/lang-sql`, Radix primitives (`@radix-ui/react-dialog`, `-dropdown-menu`, `-popover`, `-tooltip`, `-tabs`, `-select`, `-switch`, `-slider`) wrapped as local shadcn-style components, `cmdk` (T2), `html-to-image`, `@fontsource-variable/geist` + `@fontsource-variable/geist-mono` (fallback Inter / JetBrains Mono).
- **web, keep:** `recharts` (throttle updates; switch to `uplot` only if it struggles at 1 Hz), `lucide-react`, `socket.io-client`, `react-router-dom`.
- **web, remove:** `animejs`; `motion` if unused.
- **server:** keep express, mysql2 (`namedPlaceholders: true`), zod, socket.io, ioredis. Hand-write the PRNG, generators and USL fit; add no heavy dependencies.
- **shared:** a new npm workspace `shared` with zod schemas and TS types for design, schema model, workload, run settings, report and socket events, imported by both server and web. Verify that Vite (dev and build), tsx and vitest all resolve it.
- **e2e:** `@playwright/test` with Chromium.
- **Vite base:** keep `base: '/DataSim/'` (GitHub Pages workflow). The app URL stays `http://localhost:5173/DataSim/`.

---

## 8. Execution plan and team

You are the lead. Use subagents for parallel workstreams with strict file ownership. Run at most 4 subagents at once.

Each subagent prompt must include: its scope; the paths it owns; the brief sections to read; the shared contracts it must honor; its acceptance gates; "don't edit outside your owned paths; ask the lead for contract or dependency changes"; and "finish with a report: done / not done / how verified." If your Claude Code version supports worktree isolation for subagents, use it for parallel builders and merge the results yourself. Otherwise, sequence builders that touch overlapping files. The lead runs typecheck and tests after every merge, before starting the next wave.

**P0 — Recon and setup (≤ 40 min).** Read README, `docs/`, `server/src`, `web/src`, this brief and Appendix A (plus `docs/review1/*.pdf` if present). Check Docker and Node; `npm ci`; `npm run db:up`; run the existing tests and record the baseline. Tag `v1-friend`; create branch `v2`. Write PLAN, PROGRESS and DECISIONS. Decide the retire list from the dependency graph.

**P1 — Foundations (lead alone, ≤ 90 min).**
- The shared package with all zod contracts.
- Migration 002 for the meta tables.
- The restricted user `dsim_runner`, created idempotently at server start.
- Delete the retired code.
- A new app shell: rail, routing, design tokens, fonts, dark theme, and base components (Button, IconButton, Input, NumberField with units, Select, Tabs, Dialog, Popover, Tooltip, Pill, Table, Skeleton, Toast, Kbd, SplitButton, EmptyState, ProvenanceTag, StatusDot).
- `npm run demo` and `npm run doctor`.
- Install every planned dependency now.
- Gate: typecheck + build green, server boots, `/api/health` OK, shell renders.

**P2 — Core (parallel wave 1, ≤ 4 h):**
- **A — Engine (server):** sandbox provisioner (DDL generator, apply, seed, restricted user); workload runner (VUs, topology path, LB, app worker queues, real pools, Redis cache-aside, retries, error classes); samplers (status deltas, lock waits); post-run analysis (invariants, digests, EXPLAIN, findings v1, SLO); persistence; REST + Socket.IO; capacity runner + USL fit. Unit tests (DDL generator, generator determinism, USL fit, error classification) and integration tests against real MySQL.
- **B — Studio UI:** Projects page, Studio layout, palette, canvas with custom nodes and edges per §5.2, inspector forms bound to a zustand store with undo/redo, connection validation, draft autosave, revision pill, run controls, live panel wired to Socket.IO, animated edges, bottleneck highlighting.
- **C — Editors UI:** Schema Designer, Workload Editor (with Test once), Invariants editor.
- **D — Templates:** T1 + T2 as design JSON (validated by the shared zod schemas), seeded on startup, with integration tests asserting the expected outcomes.
- **Gate — the vertical slice. It must be green before anything else is built:** fresh DB → `npm run demo` → open T1 → Load test with `naive` → live charts stream → report shows violations > 0 → switch strategy to `atomic` → re-run → 0 violations → Compare shows both runs. Automate it with Playwright.

**P3 — Depth (wave 2, ≤ 2.5 h):**
- **F:** Report, Runs and Compare polish; export; capacity UI; findings fix buttons (apply index → new revision → re-run).
- **G:** Concurrency Lab and Stepper reskins on the legacy endpoints.
- **E (Tier 2):** compare-strategies one-click, normalization assistant, DDL import, SQL console, T3 + T4, command palette, canvas PNG export, invariant sampling during runs, a "Which database fits?" heuristics card (rule-based on read/write ratio, contention, transactional needs; labeled as a heuristic), Stepper on project templates.

**P4 — QA and polish (≥ 1.5 h; starts at FEATURE_FREEZE at the latest).** The full e2e suite; the screenshot review loop; the fresh-clone test; a performance sanity pass (memoized nodes, throttled socket updates, no jank during runs); fix everything found.

**P5 — Docs and handoff (≥ 45 min).** §10.

**Tiers:**
- **Tier 1 (must):** real sandbox + DDL + seed; workload engine with topology and cache; live metrics; report; invariants; findings v1 (full scan → add index, contention, deadlocks, pool starvation); SLO verdict; capacity test + USL; Compare (manual selection); T1 + T2; Studio canvas + inspector + Schema Designer + Workload Editor + Test once; Concurrency Lab and Stepper reskins; export MD/CSV/DDL; docs.
- **Tier 2 (should):** everything listed under E.
- **Tier 3 (could):** read replica, PostgreSQL adapter.
- **Cut entirely:** auth, multi-user collaboration, any LLM/AI feature, cloud deploy, failure injection, mobile layouts.

---

## 9. Verification

- **Every gate:** `npm run typecheck`, `npm test` (server unit + integration against Docker MySQL; web unit tests for stores, validators and the normalization module) and `npm -w web run build` must all be green.
- **Playwright e2e** (`npm run e2e`, headless Chromium, installs its own browser). Use short-duration overrides so the whole suite runs in under 6 minutes. Flows:
  1. T1 naive vs atomic (the vertical slice).
  2. Schema Designer: add a table, a column and an FK; see the DDL; provisioning succeeds.
  3. Workload Editor: Test once.
  4. A capacity test completes and shows the USL curve.
  5. Findings → apply index → new revision → re-run shows a lower p95 for `search_sections`.
  6. Lab and Stepper pages load and one action works.
  7. No browser console errors in any flow.
- **Screenshot review.** The e2e suite saves screenshots of every screen and state (1440 × 900, dark) to `.datasim-v2/screens/`. After each UI wave, open them with the Read tool and critique them against §5 like a senior product designer: alignment, 4/8 px spacing rhythm, truncation, overflow, empty states, contrast, consistency of pills and fonts, and no leftover playful styling. Fix, re-shoot. Do at least 2 full passes in P4.
- **Independent review.** In P4, spawn one fresh reviewer subagent that hasn't seen the work. It reviews the screenshots and runs `docs/DEMO.md` step by step through Playwright, then reports issues by severity. Fix every high and medium.
- **Fresh-clone test.** Clone branch `v2` into a temp dir, `npm ci`, `npm run demo`, and run e2e flow 1. It must pass.
- **Demo priming.** `npm run demo:prime` runs every DEMO.md run headlessly so the reports already exist as a fallback if something fails live.

---

## 10. Docs deliverables

Rewrite README; move outdated docs to `docs/archive/`.

- **`README.md`:** what it is (2 paragraphs + a screenshot), quick start (`npm run demo`), features, a mermaid architecture diagram, the MEASURED / EMULATED / PROJECTED model, tech stack, project structure, tests, credits. Credits: Akshat Raj 24BCE0043, Vishal Vivek 24BCE2377, Mohit Kumar 24BCE2378. Use these registration numbers; the old `submission/` markdown has typos (2877/2878).
- **`docs/DEMO.md`:** a 6–8 minute live demo script with exact clicks, talking points, expected number ranges, and the fallback (primed reports). Suggested flow: open T1 → walk the canvas (users → LB → apps → cache → MySQL) → double-click MySQL to show the ER diagram and real DDL → workload editor, Test once → load test with `naive` (live charts, animated edges) → report: overbooked sections, lost updates, findings → switch to `atomic` → re-run → 0 violations → Compare → apply the index finding → re-run → p95 drop → capacity test → USL verdict → quick tour of the Concurrency Lab and Stepper (deadlock with live lock table) → close on the Review 1 traceability.
- **`docs/ARCHITECTURE.md`:** components, the execution model (§4.1), a mermaid sequence diagram of one request, sandbox and SQL safety, concurrency design.
- **`docs/DATABASE_DESIGN.md`:** the meta schema as a mermaid `erDiagram`, the relational schema, keys and constraints, FDs per table, the normalization argument (3NF/BCNF), the JSON-vs-relational justification, and indexes with the queries they serve. Also each template's schema with an ER diagram and normalization notes (T1's composite FK as controlled redundancy, mirroring Review 1 §8.5).
- **`docs/REVIEW1_TRACEABILITY.md`:** a table mapping every Review 1 objective, included-scope item, functional requirement, entity and workflow step to where it's implemented (route, file, screen) and its status. Be honest about anything partial.
- **`docs/VIVA.md`:** 25 likely viva questions with crisp answers: ACID; isolation levels and the anomalies observed; strict 2PL and next-key locks; MVCC; deadlock detection; why MySQL; why real tables; how latency is measured; what is emulated and why that's still valid; USL and Little's law; normalization of the meta schema; how the index advisor works; the security of user SQL; limitations.
- **`MORNING_REPORT.md`** (repo root): status per tier (done / partial / cut); how to run; pointer to the demo script; known issues and workarounds; what was verified (commands + results); last green commit hash; the screenshot list; a 10-minute morning checklist for the user.

---

## 11. Definition of done

- `npm run demo` works on a fresh clone; each flagship demo run finishes live in under 2 minutes.
- Tier 1 is complete; typecheck, tests, build and e2e are green; no browser console errors; no TODO or placeholder UI; no leftover mascot, music or story UI anywhere.
- Screens look consistent and professional per §5, with two review passes done.
- Docs are complete; `MORNING_REPORT.md` is written; branch `v2` is committed (and pushed if possible).

---

## Appendix A — Review 1 commitments (submitted 26 Sep 2026; cannot change)

If `docs/review1/` contains the PDF, read it. Otherwise this summary is authoritative.

- **Title:** DataSim: A General-Purpose Simulation Lab for High-Impact Database Scenarios. Scenario family: shared-resource workflows (inventory, reservations, payments, banking, collaboration, job processing, quota management).
- **Background:** an interactive database simulation lab that makes concurrency behavior visible, "like a focused learning simulator such as Cisco Packet Tracer": approachable interfaces for constructing and observing scenarios, plus technical views for transactions, locks, constraints, isolation levels and results. Future scenarios reuse the platform's controls, instrumentation, experiment runner and visualizations.
- **Problem:** How can a relational DBMS maintain correct real-time shared state under concurrent operations, and what correctness/performance trade-offs do different transaction, isolation, locking and constraint strategies introduce? Also the lost-update problem.
- **Objectives:**
  1. Model users, resources, operations, events and experiment results in a normalized relational DB.
  2. Demonstrate anomalies with reproducible scenarios.
  3. Compare naive operations, transactions, serializable isolation, pessimistic locking, optimistic version checks, unique constraints, triggers and a Redis lease.
  4. Show how isolation levels affect visibility, blocking, deadlocks and correctness.
  5. Visualize transaction schedules, lock information, wait-for relationships, rollbacks and invariant checks.
  6. Simulate scalable groups of virtual users using real DB transactions across reusable scenario patterns.
  7. Provide a friendly interface for learners and a technical interface for inspection.
  8. Persist experiment configurations and results for comparison.
  9. Keep the platform extensible.
- **Included scope:** MySQL 8.4/InnoDB; a relational schema for users, resources, allocations, operations, events and experiment runs; limits/leases/expiry; multiple concurrency-control strategies; lost-update experiments; a Transaction Stepper; a Concurrency Lab; a Simulation Control Room for virtual users and real DB traffic; InnoDB lock and wait-for information; invariant checks; React UI, Node/TS API, Docker, automated tests.
- **Excluded scope:** real domain services; production auth and payments; production cloud scale; recommendations and social features; claims about commercial systems' internals; unlimited arbitrary workloads (bounded, controlled scenarios only).
- **Users:** student/learner, demonstrator/instructor, technical user, developer.
- **Required operations:** look up accounts; create/update/reserve/release/cancel allocations; renew leases; resolve conflicts by policy; reject expired/duplicate/stale requests; switch strategy; run quota, allocation and lost-update experiments; step two transactions statement by statement; start/pause/resume/stop a crowd simulation; inspect live state, events, locks and experiment history.
- **Retrieve/analyze:** active sessions per account, invariant status, lost updates, outcomes, retries, deadlocks, rollbacks, lock waits, latency percentiles, throughput, violation counts, event timelines, strategy comparisons.
- **Functional requirements:**
  - FR1: store user, client, resource, allocation, event and experiment data.
  - FR2: support concurrent claims/updates.
  - FR3: implement and compare strategies.
  - FR4: record experiment configs and results.
  - FR5: expose invariant checks.
  - FR6: friendly controls + technical views.
  - FR7: reject expired/preempted/duplicate/stale operations.
- **NFRs:** correctness, repeatability, observability, bounded scalability, maintainability, local portability, usability; experiments persisted.
- **Technology:** MySQL 8.4 (InnoDB), Redis 7 (optional lease comparison), Node.js, TypeScript, Express, React, Socket.IO; justified by ACID, isolation levels, row/next-key locking, FKs/unique/checks/triggers/generated columns, performance-schema lock inspection, Docker reproducibility.
- **Entities:** USER_ACCOUNT, CLIENT, RESOURCE, ALLOCATION, OPERATION_EVENT, EXPERIMENT_RUN, with the keys and constraints listed in T2: the composite FK `allocation(client_id, account_id) → client`, `UNIQUE(client_id, client_request_id)` for idempotency, the generated-column unique index for one active allocation per account, and checks. Core invariant: active allocations and consumed quantity stay within quota/capacity. Normalization claim: 3NF, with controlled denormalization (`account_id` in allocation) kept consistent by the composite FK.
- **Architecture:** users → React web → Node.js API services → MySQL 8.4 (+ Redis 7) → checks, metrics, verdicts.
- **Workflow:** select scenario + strategy → API request → begin transaction and read shared state → apply strategy → MySQL grants/rejects/waits/deadlocks/rolls back → commit or roll back, record event/result, publish state → UI shows sessions, metrics, checks, timelines, diagnostics.
- **Outputs:** friendly views, live state, strategy verdicts, transaction schedules, lock/wait info, experiment history, latency/throughput, violation counts, CSV/Markdown results.

**Mapping to v2:**
- "Simulation Control Room / virtual users" → Studio runs.
- "Concurrency Lab" → `/lab` + Compare strategies.
- "Transaction Stepper" → `/stepper`.
- EXPERIMENT_RUN → the `run` table and its children.
- USER_ACCOUNT, CLIENT, RESOURCE, ALLOCATION, OPERATION_EVENT → T2's real tables.
- Strategies → T2 variants + the Strategy Benchmark (CONSTRAINT, TRIGGER, REDIS_LEASE) + schema forks (CONSTRAINT).