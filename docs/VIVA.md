# DataSim viva preparation: 25 likely questions

Short, defensible answers. Where DataSim itself demonstrates the point, the demo step is in brackets.

## Transactions, isolation and locking

**1. What is ACID, and where do you see each property in DataSim?**
Atomicity: a failed step rolls the whole transaction back (a rejected `register` leaves no half-written enrollment). Consistency: CHECK, FK and UNIQUE constraints plus the invariants (`no_overbooking`, `within_quota`) define valid states. Isolation: the isolation selector and the anomalies it allows or prevents. Durability: InnoDB redo log; committed enrollments survive. [Run T1 `naive`, then `atomic`; compare invariants.]

**2. What are the isolation levels and which anomalies does each allow?**
READ UNCOMMITTED: dirty reads. READ COMMITTED: no dirty reads, but non-repeatable reads and phantoms. REPEATABLE READ (MySQL default): consistent snapshot per transaction (MVCC), so no non-repeatable reads; InnoDB also blocks most phantoms for locking reads with next-key locks. SERIALIZABLE: reads become locking reads, so concurrent conflicting transactions block or deadlock instead of producing anomalies, at a throughput cost. Note that **lost update still happens at REPEATABLE READ** when the application does read-modify-write with plain SELECTs. [Concurrency Lab: TXN_RR violates; T1 `naive` at REPEATABLE READ overbooks.]

**3. What is a lost update, and why does `naive` overbook seats?**
Two transactions read `enrolled = 59`, both pass the check `59 < 60`, both write `60`. One increment is lost, or (with the INSERT into `enrollment`) both students are enrolled and the true count is 61 > capacity. The read and the write are not atomic with respect to each other. [Report: `no_overbooking` and `counter_consistent` violations.]

**4. What is strict two-phase locking and how does InnoDB relate to it?**
Strict 2PL: a transaction acquires locks as it goes (growing phase) and releases all exclusive locks only at commit/rollback, which guarantees conflict-serializable and recoverable schedules. InnoDB uses row-level S and X locks held until the end of the transaction for locking reads and writes (strict 2PL for those statements), while plain consistent reads use MVCC and take no locks. [Stepper: second transaction blocks until the first commits.]

**5. What are record, gap and next-key locks?**
A record lock covers one index record. A gap lock covers the open interval between index records (it prevents inserts into the gap). A next-key lock is a record lock plus the gap before it. At REPEATABLE READ, range scans with `FOR UPDATE` or `UPDATE` take next-key locks, which is how InnoDB prevents phantoms. Without a usable index the scan locks many more records, which is why an index also reduces contention. [Concurrency Lab: index experiment, lock footprint with and without the composite index.]

**6. What is MVCC?**
Multi-version concurrency control: InnoDB keeps old row versions in the undo log; a plain SELECT reads the version visible to its read view, so readers do not block writers and writers do not block readers. `SELECT ... FOR UPDATE` and DML read the latest committed version and lock it. That is why the `naive` strategy's plain SELECT is stale by the time the UPDATE runs.

**7. How does deadlock detection work?**
InnoDB maintains a wait-for graph (transaction T1 waits for T2 ...). When a wait would create a cycle it picks a victim (the transaction that has modified the fewest rows), rolls it back, and returns error 1213. The application must retry. Deadlocks are prevented by acquiring locks in a consistent order. [T4: `unordered` transfers deadlock, `ordered` do not; wait-for graph and deadlock count in the report.]

**8. Pessimistic vs optimistic vs atomic update: when would you use each?**
Pessimistic (`SELECT ... FOR UPDATE`): lock first, safe under high contention, lowest retry waste, but holds locks longer. Optimistic (version column compare-and-set, retry on 0 rows): no locks while thinking, best when conflicts are rare, wasteful when they are common. Atomic (`UPDATE ... SET enrolled = enrolled + 1 WHERE enrolled < capacity`): the database does the check and the write in one statement under one row lock; the simplest and fastest when the logic fits in one statement.

**9. What does the CONSTRAINT strategy show?**
That a concurrency-control strategy can live in the schema. The generated column `active_account_id` plus `UNIQUE(active_account_id)` lets the database itself reject a second active allocation, no matter how buggy the application is. [Fork T2, add the unique index, re-run.]

## Design and modelling

**10. Why MySQL/InnoDB?**
Review 1 committed to it for a reason: row-level locking, MVCC, selectable isolation levels, FKs, CHECK constraints (8.0.16+), generated columns, and `performance_schema` lock tables (`data_locks`, `data_lock_waits`) that let us show real lock and wait-for information. Docker makes it reproducible.

**11. Why real tables instead of simulated data?**
A simulator that models locks in application code only demonstrates the author's model. Real tables, real indexes and a real optimizer mean latency, lock waits, deadlocks and query plans are what an actual InnoDB server produces. v1 stored rows as JSON blobs in one table; there were no indexes, FKs or plans, so it could not show index effects or real contention.

**12. How is the meta schema normalized?**
See DATABASE_DESIGN.md. BCNF throughout; composite keys `(run_id, ...)` for child tables with `ON DELETE CASCADE`; one second candidate key `(project_id, content_hash)`. JSON is used only for the editor document, which is read and written whole. Stored run aggregates are a documented, write-once denormalization.

**13. Why does `enrollment` repeat `course_id`?**
Controlled redundancy from Review 1 section 8.5: `section_id -> course_id` already holds, but the composite FK `(section_id, course_id) -> section(section_id, course_id)` guarantees the copy is consistent, and `UNIQUE(student_id, course_id)` then enforces "one section per course per student" declaratively.

## Measurement and modelling

**14. How is latency measured, and what is emulated?**
Each request carries `process.hrtime.bigint()` timestamps for: queue wait at the app server, link latency, app processing, connection-pool wait and database execution. DB execution, lock waits, deadlocks, rows examined, invariants and end-to-end wall-clock latency are **MEASURED**. Link latency, app processing time and the load balancer are **EMULATED** (real awaits in the request path, so they genuinely hold virtual users and create queueing). The cache is a real Redis. **PROJECTED** numbers come from a fitted model and are shown dashed.

**15. Why is emulating network and app time still valid?**
They are modelled as service times at queueing stations in the request path: they occupy workers and users exactly as real delays would, so queueing, saturation and the knee behave as in a real system. What is not claimed: that the emulated numbers equal any specific production network.

**16. What is Little's law and how is it used?**
`N = X * (R + Z)`: concurrent users equal throughput times (response time plus think time). With closed-loop virtual users we know N, Z and measure X and R, so the equality is a sanity check that the measurement is internally consistent.

**17. What is the Universal Scalability Law?**
`X(N) = lambda*N / (1 + sigma*(N-1) + kappa*N*(N-1))`: `lambda` is single-user throughput, `sigma` models contention (serialization, like a hot-row lock) and `kappa` models coherency cost (crosstalk, which makes throughput fall past the peak). DataSim fits sigma and kappa to the measured capacity steps by bounded least squares (both non-negative), reports the peak `N* = sqrt((1 - sigma)/kappa)`, `X_max` and R^2, and plots the curve dashed beyond the largest tested N because it is a projection.

**18. What is a capacity-test knee?**
The first load step where throughput grows by less than 10% while p95 latency grows by more than 50%, or where the SLO breaks: the system has saturated a resource.

**19. How does the index advisor work?**
After the run it takes `EXPLAIN FORMAT=JSON` of each statement template with sample parameters and reads `performance_schema.events_statements_summary_by_digest` (rows examined, no-index-used counts). A full scan (access type ALL) over at least 1,000 rows triggers a finding with the equality-filtered columns as the proposed index. One click applies it as a new design revision and re-running shows the effect. It is rule-based, not a cost model: it does not compare alternative indexes.

## Safety and limits

**20. How do you keep user-written SQL safe?**
Workload SQL runs as `dsim_runner`, which has only `SELECT, INSERT, UPDATE, DELETE` on `dsim\_%`.*: no DDL, no access to the meta database. Statements must start with SELECT/INSERT/UPDATE/DELETE/WITH, multi-statements are rejected, and values are always bound as parameters. DDL is generated by DataSim and executed by the admin connection only.

**21. What happens when the cache hit ratio is high; why does it matter?**
Cacheable read-only transactions never reach MySQL on a hit, so DB load drops and p95 for those transactions falls. It also hides stale data: a cache-aside read can return a seat count older than the TTL, which is acceptable for search results but not for the registration decision (which is never cached).

**22. Why one active run at a time?**
Measurement validity: concurrent runs would compete for the same MySQL server and CPU and distort every number. A global lock (in-process plus a MySQL named lock) enforces it.

**23. What are DataSim's limitations?**
Single MySQL node (no replication); one laptop's CPU is shared by the load generator, the server and MySQL, so absolute numbers are relative, not benchmarks; emulated network/app are models; the advisor is rule-based; the workload is bounded (one design, up to 500 virtual users), not arbitrary production traffic.

## Process

**24. How does this map to Review 1?**
See REVIEW1_TRACEABILITY.md: Simulation Control Room becomes Studio runs, the Concurrency Lab and Stepper are kept, the T2 template is the exact Review 1 schema, the eight strategies are covered by T2 variants, the Strategy Benchmark and schema forks.

**25. What would you do next?**
A real read replica with GTID replication and `Seconds_Behind_Source` measurement; a PostgreSQL adapter to compare engines; sampling invariants during the run; cost-based index recommendations using hypothetical-index evaluation.
