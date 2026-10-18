# Review 1 traceability

Review 1 (submitted 26 Sep 2026) is fixed. This table maps each commitment to where DataSim v2 implements it. Status: **Done**, **Partial** (what is missing is stated), **Changed** (implemented differently, with the reason).

## Objectives

| # | Review 1 objective | Where | Status |
| --- | --- | --- | --- |
| 1 | Model users, resources, operations, events and experiment results in a normalized relational DB | T2 template schema (`server/src/templates/t2SharedResource.ts`); meta schema `db/migrations/005_datasim_v2.sql`; legacy lab tables `db/schema.sql`; [DATABASE_DESIGN.md](DATABASE_DESIGN.md) | Done |
| 2 | Demonstrate anomalies with reproducible scenarios | Seeded PRNG + fixed seed per run; T1/T2 `naive` variants overbook / exceed quota; Concurrency Lab lost-update; template outcome tests `server/test/projects/outcomes.test.ts` | Done |
| 3 | Compare naive, transactions, serializable, pessimistic, optimistic, unique constraint, triggers, Redis lease | Concurrency Lab Strategy Benchmark (all eight: `server/src/strategies/*`, `/lab`); T2 variants naive / serializable / pessimistic / optimistic; CONSTRAINT as a schema fork; TRIGGER and REDIS_LEASE in the Lab only | Done (TRIGGER and REDIS_LEASE are Lab-only by design: a strategy can live in the schema or in Redis, not just in code) |
| 4 | Show how isolation levels affect visibility, blocking, deadlocks, correctness | Isolation selector in Studio (DB node); Transaction Stepper with per-transaction isolation (`/stepper`); Lab isolation parameter | Done |
| 5 | Visualize schedules, lock information, wait-for relationships, rollbacks, invariant checks | Stepper (statement-by-statement schedule, `performance_schema.data_locks` / `data_lock_waits`, wait-for graph); run report lock waits + wait-for graph, invariants, rollbacks counted as rejected / retried | Done |
| 6 | Scalable groups of virtual users using real DB transactions across reusable scenario patterns | Studio runs: virtual users 1-500 with constant / ramp / spike / step patterns, real `mysql2` pools and transactions; four templates | Done (bounded to 500 VUs) |
| 7 | Friendly interface for learners and a technical interface for inspection | Studio canvas (friendly) + report, statements, EXPLAIN, locks (technical) | Done |
| 8 | Persist experiment configurations and results | `design_revision` (immutable configs), `run` and its child tables; Lab `experiment_run`; CSV / Markdown export | Done |
| 9 | Keep the platform extensible | Templates are data (`DesignDoc` JSON validated by zod), shared contracts in `shared/`, strategy variants per transaction | Done |

## Included scope

| Item | Where | Status |
| --- | --- | --- |
| MySQL 8.4 / InnoDB | `docker-compose.yml`; engine runs real DDL and transactions | Done |
| Relational schema for users, resources, allocations, operations, events, experiment runs | T2 (`user_account`, `client`, `resource`, `allocation`, `operation_event`); `run` = EXPERIMENT_RUN | Changed: EXPERIMENT_RUN became the richer `run` + child tables |
| Limits / leases / expiry | Legacy tables and Lab strategies (leases, reaper in v1 history); T2 `lease_expires_at`, `allocation.status` | Partial: lease expiry is modelled in the schema and exercised by the Lab; the v1 live lease-reaper service is retired with the v1 UI |
| Multiple concurrency-control strategies | See objective 3 | Done |
| Lost-update experiments | Lab lost-update (NAIVE_RMW, ATOMIC, LOCKED, CAS); T2 / T3 `bump_counter` / `checkout` | Done |
| Transaction Stepper | `/stepper`, `server/src/lab/stepper/*` | Done |
| Concurrency Lab | `/lab`, `server/src/lab/*` | Done |
| Simulation Control Room for virtual users and real DB traffic | Studio Run + Live panel; Compare strategies | Changed: the control room became the Studio run panel. Pause / resume of a crowd is not offered; runs can be started and cancelled |
| InnoDB lock and wait-for information | Stepper lock table; run `run:locks` stream + `run_lock_wait` | Done |
| Invariant checks | Per-design SQL invariants (`run_invariant`), Lab invariant | Done (sampling during the run was cut; checks run after the run) |
| React UI, Node/TS API, Docker, automated tests | Whole repo; vitest, supertest, Playwright | Done |

## Excluded scope (unchanged)

Real domain services, production auth and payments, production cloud scale, recommendations and social features, claims about commercial systems' internals, and unlimited arbitrary workloads: all remain out of scope. Workloads are bounded and run as a restricted SQL user.

## Functional requirements

| FR | Where | Status |
| --- | --- | --- |
| FR1 store user, client, resource, allocation, event, experiment data | T2 schema; `run*` tables | Done |
| FR2 concurrent claims / updates | Engine virtual users; Lab races | Done |
| FR3 implement and compare strategies | Compare, Compare strategies, Lab | Done |
| FR4 record experiment configs and results | `design_revision`, `run*`, `experiment_run` | Done |
| FR5 expose invariant checks | Workload Editor invariants (*Check now*), report invariants, `/api/runs/:id` | Done |
| FR6 friendly controls + technical views | Studio + report | Done |
| FR7 reject expired / preempted / duplicate / stale operations | T2 `claim` variants and `operation_event` `UNIQUE(client_id, client_request_id)`; business `guard` rejections counted as REJECTED | Done |

## Non-functional requirements

| NFR | How it is met |
| --- | --- |
| Correctness | Invariants after every run; real InnoDB semantics |
| Repeatability | Seeded PRNG; seed recorded on every run; immutable revisions |
| Observability | 1 Hz samples, lock waits, digests, EXPLAIN, provenance tags |
| Bounded scalability | VUs <= 500, pool <= 250 connections, one run at a time |
| Maintainability | Shared zod contracts, tests at every layer |
| Local portability | `npm run demo`, Docker Desktop, no external services or CDNs |
| Usability | Packet-Tracer-style canvas, connection rules with explanations |
| Experiments persisted | See objective 8 |

## Entities (T2 template, exact Review 1 shape)

| Entity | Table | Keys and constraints implemented |
| --- | --- | --- |
| USER_ACCOUNT | `user_account` | PK, `UNIQUE(username)`, `CHECK(quota BETWEEN 1 AND 10)`, `conflict_policy` enum, `state_version`, `is_lab` |
| CLIENT | `client` | `UNIQUE(account_id, client_name)`, `UNIQUE(client_id, account_id)` (target of the composite FK), FK to account |
| RESOURCE | `resource` | PK, `CHECK(capacity >= 0)` |
| ALLOCATION | `allocation` | composite FK `(client_id, account_id) -> client`, generated column `active_account_id`, index `(account_id, status, lease_expires_at)` |
| OPERATION_EVENT | `operation_event` | `UNIQUE(client_id, client_request_id)` for idempotency |
| EXPERIMENT_RUN | `run` (+ children) | see DATABASE_DESIGN.md |

Normalization claim (3NF with controlled denormalization of `account_id` in allocation, kept consistent by the composite FK) is shown in DATABASE_DESIGN.md. The CONSTRAINT strategy (`UNIQUE(active_account_id)`) is demonstrated by forking the design and adding the unique index.

## Architecture and workflow

Review 1: users -> React web -> Node API -> MySQL 8.4 (+ Redis 7) -> checks, metrics, verdicts. v2 keeps exactly this pipeline ([ARCHITECTURE.md](ARCHITECTURE.md)). Workflow: select template + strategy -> run -> engine opens a transaction, reads shared state, applies the strategy -> MySQL grants / rejects / waits / deadlocks / rolls back -> commit or rollback, results recorded -> UI shows metrics, checks, timelines, diagnostics.

## Outputs

Friendly views, live state, strategy verdicts, transaction schedules (Stepper), lock / wait information, experiment history (Runs, Lab history), latency / throughput, violation counts, CSV / Markdown results (report and Lab exports): all present. Event timelines: operation events are stored (T2 `operation_event`) and the run log shows the phase timeline; a per-account event timeline view is not built (**Partial**).
