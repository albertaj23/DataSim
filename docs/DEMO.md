# DataSim live demo (6-8 minutes)

Flagship: **Course Registration Rush** (FFCS-style registration). Every run finishes live in under 2 minutes. Numbers below were measured on a laptop with MySQL 8.4 in Docker; ranges vary with the machine, the shape does not.

## Before you start

```bash
npm ci
npm run demo            # starts Docker (MySQL 8.4 + Redis 7), API, web; prints the URL
npm run demo:prime      # optional, ~5 min: pre-runs every run below so reports already exist (fallback)
```

Open **http://localhost:5173/DataSim/**. Health dot (bottom-left of the rail) should be green. `npm run doctor` explains anything red.

**Fallback if anything fails live:** `Runs` (left rail) lists the primed run "Course Registration Rush (primed)": naive, atomic, atomic + index, capacity. Open them and narrate from the reports; Compare works on them.

## Script

### 1. The idea (30 s)
"DataSim is Packet Tracer for database engineers: I design the system, DataSim runs it against a real MySQL 8.4 server and tells me where it breaks before I build it." Point at the *measured / emulated / projected* tags: "every number says where it came from".

### 2. The canvas (45 s)
Projects -> click the **Course Registration Rush** template card. Walk left to right: *Students* (150 virtual users, spike = "registration opens") -> *Load balancer* -> *App servers* (2 instances, 32 workers, pool 16, strategy selector) -> *Redis cache* and *MySQL* (REPEATABLE READ, lock wait 3 s). Click a node: inspector shows its settings. Try dragging *Students* onto *MySQL*: a toast explains why it is rejected (connection rules).

### 3. The real schema (45 s)
Double-click **MySQL**. ER diagram: department, student, faculty, course, section, enrollment. Open the **DDL** tab: real `CREATE TABLE` with PK, composite FK `enrollment(section_id, course_id) -> section`, CHECKs. Point out that `section` has **no index on `slot`** (the advisor will find it). Click **Provision sandbox** (a couple of seconds): "this created real tables and 24,000 sections in MySQL". Esc to close.

### 4. The workload (45 s)
Double-click **Students**. `register` (55%), `search_sections` (35%, cacheable), `my_timetable` (10%). Open `register` -> tabs **naive / pessimistic / optimistic / atomic**. In `naive`: read `enrolled`, guard `enrolled < capacity`, insert enrollment, write `enrolled + 1` from the stale read. Click **Test once**: each step's rows, affected count and ms, run in a transaction that is rolled back. Show *Invariants*: `no_overbooking`, `counter_consistent`.

### 5. Load test with the naive strategy (60 s)
Top bar: **Strategy = naive**, then **Run**. Talking points while it streams: provisioning progress -> warm-up -> measuring; animated request dots on the edges; node pills (`tps`, `p95`, `pool 16/16`, `hit %`); the **bottleneck** pill on the app node.
Expected: ~400-500 tps, p95 ~300-400 ms, **SLO FAIL**, and **invariant violations > 0 (about 30-60)**. In the bottom panel open **Invariants**: overbooked sections and counters that disagree with the true enrollment count. Open **Findings**: "Invariant violated under the naive strategy" with the theory: two transactions read the same stale `enrolled`, both pass the check, both write: a **lost update**, even at REPEATABLE READ. Also *Lock waits concentrate on section*: hot-row contention (zipf popular sections).

### 6. Fix it: atomic (45 s)
Strategy = **atomic**, Run. Expected: ~650-700 tps, p95 ~70 ms, **0 violations, SLO PASS**. "One statement does the check and the write under one row lock: `UPDATE ... SET enrolled = enrolled + 1 WHERE enrolled < capacity`."

### 7. Compare (30 s)
Left rail -> **Runs**, tick the naive and atomic runs, **Compare**. Side-by-side metrics with green/red deltas (TPS up ~50%, p95 down ~80%, violations 100% down), overlaid TPS/p95 charts, and "What changed" (strategy naive -> atomic).

### 8. The advisor (60 s)
Open the atomic run's report -> **Findings** -> "Full table scan on `section` (filter on `slot`)": `rows examined per exec` ~13,000, access type ALL. Click **Apply fix** (creates a new revision: "Add index on section(slot)") then **Re-run**.
Expected: the statement's average time drops from ~6.5 ms to ~2 ms, rows examined 67M -> ~5M, `search_sections` DB time per call ~6 -> ~3 ms and its p95 drops (~48 -> ~42 ms); the finding disappears. Compare old vs new to show the *design diff* (index added). Mention: at higher load, hot-row contention on `register` becomes the next bottleneck (the advisor says so).

### 9. Capacity test (60 s)
Studio -> Run dropdown -> **Capacity test**. Steps 50, 150, 300, 450, 500 virtual users. Report shows: measured points, the fitted Universal Scalability Law curve (dashed = PROJECTED beyond the tested load), the knee, and the sentence, e.g. *"Sustains ~1,800 tps at p95 <= 200 ms up to ~430 VUs; projected peak ~1,820 tps at ~415 VUs (USL, R^2 1.00)."* Explain sigma (contention) and kappa (coherency), and Little's law check below.

### 10. Review 1: Concurrency Lab and Transaction Stepper (60 s)
**Concurrency Lab** (flask icon): Strategy benchmark -> all eight Review 1 strategies (NAIVE, TXN_RR, SERIALIZABLE, PESSIMISTIC, OPTIMISTIC, CONSTRAINT, TRIGGER, REDIS_LEASE). Run NAIVE with 20 clients: violations; the safe ones show 0. "A strategy can live in the schema (CONSTRAINT: a unique index on a generated column) or in Redis (lease), not just in code."
**Stepper** (list icon): scenario **Classic deadlock** -> *Load scenario*, press **N** (run next) until the deadlock appears: real errno 1213, the live `data_locks` table and the wait-for graph with the cycle.

### 11. Close on Review 1 (15 s)
`docs/REVIEW1_TRACEABILITY.md`: every Review 1 objective, entity and workflow step mapped to a screen, route and file. The `Review 1: Shared Resource Allocation` template is the exact Review 1 schema (composite FK, generated column, idempotency key).

## Other things worth showing if asked
* **Ctrl+K** command palette; **Normalize** in the Schema Designer (closure, candidate keys, BCNF/3NF with lossless-join check, apply decomposition); **Query** tab in the Schema Designer (read-only SQL console on the sandbox); "Which database fits?" heuristic card on the database node (labelled as a heuristic).
* *Compare strategies* in the Run menu: one click runs every strategy variant with the same seed and opens Compare.
* *Flash Sale* and *Bank Transfers* templates: stock oversell, and deadlocks from unordered locking vs ordered locking.

## Troubleshooting
| Symptom | Fix |
| --- | --- |
| Health dot red | `npm run doctor`; start Docker Desktop; `npm run db:up` |
| "A run is already active" | wait for it, or Stop in the top bar |
| Lab hangs | leave the Stepper page (open stepper transactions hold row locks), then retry |
| Numbers differ from this script | the shape matters (naive violates, atomic does not, index lowers scan cost, capacity has a knee); re-run once; close other heavy apps |
