import { DesignDoc } from '@datasim/shared';
import { BIGINT, BOOL, DT3, INT, TINYINT, POS, col, edge, enumOf, fkRef, fromTable, pattern, pick, uniformInt, varchar, char } from './dsl.js';

/** One read gives the claiming client's account, its quota/version and the current active count. */
const READ_ACCOUNT = `SELECT u.account_id, u.quota, u.state_version,
  (SELECT COUNT(*) FROM allocation a WHERE a.account_id = u.account_id AND a.status = 'ACTIVE') AS active
FROM client c JOIN user_account u ON u.account_id = c.account_id WHERE c.client_id = :client`;
const GUARD = { left: '$s.active', op: '<' as const, right: '$s.quota', onFail: 'reject' as const };
const insertAllocation = (strategy: string) => ({
  sql: `INSERT INTO allocation (client_id, account_id, resource_id, status, quantity, started_at, lease_expires_at, strategy)
VALUES (:client, :$s.account_id, :resource, 'ACTIVE', 1, NOW(3), NOW(3) + INTERVAL 60 SECOND, '${strategy}')`,
});
const INSERT_EVENT = {
  sql: `INSERT INTO operation_event (account_id, client_id, event_type, state_version, client_request_id, created_at)
VALUES (:$s.account_id, :client, 'CLAIM_GRANTED', :$s.state_version, UUID(), NOW(3))`,
};

const claimNaive = [{ sql: READ_ACCOUNT, bindAs: 's', guard: GUARD }, insertAllocation('naive'), INSERT_EVENT];
const claimPessimistic = [
  // The lock comes first so the snapshot used by the count is taken after we own the account row.
  { sql: 'SELECT u.account_id, u.quota, u.state_version FROM client c JOIN user_account u ON u.account_id = c.account_id WHERE c.client_id = :client FOR UPDATE', bindAs: 'u' },
  { sql: "SELECT COUNT(*) AS active FROM allocation WHERE account_id = :$u.account_id AND status = 'ACTIVE'", bindAs: 'n', guard: { left: '$n.active', op: '<' as const, right: '$u.quota', onFail: 'reject' as const } },
  { sql: `INSERT INTO allocation (client_id, account_id, resource_id, status, quantity, started_at, lease_expires_at, strategy)
VALUES (:client, :$u.account_id, :resource, 'ACTIVE', 1, NOW(3), NOW(3) + INTERVAL 60 SECOND, 'pessimistic')` },
  { sql: `INSERT INTO operation_event (account_id, client_id, event_type, state_version, client_request_id, created_at)
VALUES (:$u.account_id, :client, 'CLAIM_GRANTED', :$u.state_version, UUID(), NOW(3))` },
];

const bumpNaive = [
  { sql: 'SELECT shared_counter FROM resource WHERE resource_id = :resource', bindAs: 'r' },
  { sql: 'UPDATE resource SET shared_counter = :$r.shared_counter + 1 WHERE resource_id = :resource' },
];

export function buildSharedResource(): DesignDoc {
  return DesignDoc.parse({
    seed: 7,
    nodes: [
      { id: 'users', type: 'users', name: 'Clients', position: POS.users, config: { vus: 150, thinkMinMs: 10, thinkMaxMs: 40, thinkDist: 'uniform', pattern: 'constant', durationS: 20, warmupS: 3 } },
      { id: 'app', type: 'app', name: 'App server', position: { x: 360, y: 140 }, config: { instances: 1, workers: 64, processingMeanMs: 1, processingJitterMs: 1, poolSize: 24, strategy: 'naive', retry: { max: 5, backoffMs: 5 } } },
      { id: 'db', type: 'mysql', name: 'MySQL', position: { x: 720, y: 140 }, config: { isolation: 'REPEATABLE READ', lockWaitTimeoutS: 3, maxExecutionTimeMs: 0 } },
    ],
    edges: [edge('users', 'app', 1), edge('app', 'db', 1)],
    schema: {
      tables: [
        {
          name: 'user_account', seedRows: 500, position: { x: 0, y: 0 }, primaryKey: ['account_id'],
          columns: [
            col('account_id', INT, { ai: true }),
            col('username', varchar(40), { seed: pattern('user####') }),
            col('quota', TINYINT, { seed: pick([1, 2, 3], [0.5, 0.3, 0.2]) }),
            col('conflict_policy', enumOf('REJECT', 'TAKEOVER', 'ASK'), { seed: pick(['REJECT', 'TAKEOVER', 'ASK']) }),
            col('state_version', BIGINT, { def: 0, seed: { kind: 'constant', value: 0 } }),
            col('is_lab', BOOL, { def: false, seed: pick([0, 1], [0.9, 0.1]) }),
          ],
          uniques: [{ name: 'uq_user_account_username', columns: ['username'] }],
          checks: [{ name: 'ck_user_account_quota', expr: '`quota` BETWEEN 1 AND 10' }],
        },
        {
          name: 'client', seedRows: 2000, position: { x: 360, y: 0 }, primaryKey: ['client_id'],
          columns: [
            col('client_id', INT, { ai: true }),
            col('account_id', INT, { seed: fkRef('user_account', 'account_id') }),
            col('client_name', varchar(60), { seed: pattern('client-#####') }),
            col('client_type', enumOf('DESKTOP', 'MOBILE', 'TABLET', 'WEB'), { seed: pick(['DESKTOP', 'MOBILE', 'TABLET', 'WEB']) }),
            col('last_seen_at', DT3, { null: true, seed: { kind: 'dateRange', from: '2026-09-01 00:00:00', to: '2026-10-01 00:00:00' } }),
          ],
          uniques: [{ name: 'uq_client_account_name', columns: ['account_id', 'client_name'] }, { name: 'uq_client_id_account', columns: ['client_id', 'account_id'] }],
          foreignKeys: [{ columns: ['account_id'], refTable: 'user_account', refColumns: ['account_id'] }],
        },
        {
          name: 'resource', seedRows: 50, position: { x: 0, y: 300 }, primaryKey: ['resource_id'],
          columns: [
            col('resource_id', INT, { ai: true }),
            col('resource_name', varchar(80), { seed: pattern('Resource ###') }),
            col('resource_type', varchar(30), { seed: pick(['GPU', 'LICENSE', 'ROOM', 'SEAT']) }),
            col('capacity', INT, { seed: uniformInt(5, 50) }),
            col('shared_counter', BIGINT, { def: 0, seed: { kind: 'constant', value: 0 } }),
          ],
          checks: [{ name: 'ck_resource_capacity', expr: '`capacity` >= 0' }],
        },
        {
          // Composite FK (client_id, account_id) keeps the denormalized account_id consistent with the client's owner (Review 1 section 8.5).
          // A fork can add UNIQUE(active_account_id): the CONSTRAINT strategy, meaningful for quota-1 accounts.
          name: 'allocation', seedRows: 0, position: { x: 360, y: 300 }, primaryKey: ['allocation_id'],
          columns: [
            col('allocation_id', BIGINT, { ai: true }),
            col('client_id', INT),
            col('account_id', INT),
            col('resource_id', INT),
            col('status', enumOf('ACTIVE', 'RELEASED', 'EXPIRED', 'PREEMPTED')),
            col('quantity', INT, { def: 1 }),
            col('started_at', DT3),
            col('lease_expires_at', DT3),
            col('ended_at', DT3, { null: true }),
            col('strategy', varchar(24)),
            col('active_account_id', INT, { null: true, generated: "IF(`status` = 'ACTIVE', `account_id`, NULL)" }),
          ],
          foreignKeys: [
            { columns: ['client_id', 'account_id'], refTable: 'client', refColumns: ['client_id', 'account_id'] },
            { columns: ['resource_id'], refTable: 'resource', refColumns: ['resource_id'] },
          ],
          indexes: [{ name: 'ix_allocation_account_status_lease', columns: ['account_id', 'status', 'lease_expires_at'], unique: false }],
        },
        {
          name: 'operation_event', seedRows: 0, position: { x: 720, y: 300 }, primaryKey: ['event_id'],
          columns: [
            col('event_id', BIGINT, { ai: true }),
            col('account_id', INT),
            col('client_id', INT),
            col('allocation_id', BIGINT, { null: true }),
            col('event_type', enumOf('CLAIM_GRANTED', 'CLAIM_REJECTED', 'RELEASED', 'EXPIRED', 'PREEMPTED')),
            col('state_version', BIGINT),
            col('client_request_id', char(36)),
            col('created_at', DT3, { def: { expr: 'CURRENT_TIMESTAMP(3)' } }),
            col('detail', { kind: 'JSON' }, { null: true }),
          ],
          uniques: [{ name: 'uq_event_client_request', columns: ['client_id', 'client_request_id'] }],
          foreignKeys: [
            { columns: ['client_id', 'account_id'], refTable: 'client', refColumns: ['client_id', 'account_id'] },
            { columns: ['allocation_id'], refTable: 'allocation', refColumns: ['allocation_id'] },
          ],
        },
      ],
    },
    workload: {
      transactions: [
        {
          name: 'claim', weight: 70, readOnly: false, cacheable: false,
          description: 'A client claims a resource for its account. The account may hold at most `quota` ACTIVE allocations.',
          params: { client: fromTable('client', 'client_id', 'zipf', 1.2), resource: fromTable('resource', 'resource_id') },
          variants: {
            default: claimNaive,
            naive: claimNaive,
            serializable: claimNaive,
            pessimistic: claimPessimistic,
            optimistic: [
              { sql: READ_ACCOUNT, bindAs: 's', guard: GUARD },
              { sql: 'UPDATE user_account SET state_version = state_version + 1 WHERE account_id = :$s.account_id AND state_version = :$s.state_version', expectAffected: { op: '=', value: 1, onFail: 'retry' } },
              insertAllocation('optimistic'),
              INSERT_EVENT,
            ],
          },
        },
        {
          name: 'release', weight: 20, readOnly: false, cacheable: false,
          description: 'A client releases one of its ACTIVE allocations.',
          params: { client: fromTable('client', 'client_id', 'zipf', 1.2) },
          variants: { default: [{ sql: "UPDATE allocation SET status = 'RELEASED', ended_at = NOW(3) WHERE client_id = :client AND status = 'ACTIVE' ORDER BY allocation_id LIMIT 1" }] },
        },
        {
          name: 'bump_counter', weight: 10, readOnly: false, cacheable: false,
          description: 'Lost-update demo: increment a shared counter on a resource.',
          params: { resource: fromTable('resource', 'resource_id', 'zipf', 1.2) },
          variants: {
            default: bumpNaive,
            naive: bumpNaive,
            serializable: bumpNaive,
            pessimistic: [
              { sql: 'SELECT shared_counter FROM resource WHERE resource_id = :resource FOR UPDATE', bindAs: 'r' },
              { sql: 'UPDATE resource SET shared_counter = :$r.shared_counter + 1 WHERE resource_id = :resource' },
            ],
            atomic: [{ sql: 'UPDATE resource SET shared_counter = shared_counter + 1 WHERE resource_id = :resource' }],
          },
        },
      ],
      invariants: [
        {
          name: 'within_quota', description: 'No account holds more ACTIVE allocations than its quota.',
          sql: "SELECT COUNT(*) AS violations FROM (SELECT a.account_id FROM allocation a JOIN user_account u ON u.account_id = a.account_id WHERE a.status = 'ACTIVE' GROUP BY a.account_id, u.quota HAVING COUNT(*) > u.quota) x",
        },
      ],
    },
    slo: { p95Ms: 200, maxErrorPct: 1, perTxn: {} },
  });
}
