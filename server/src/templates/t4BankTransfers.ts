import { DesignDoc } from '@datasim/shared';
import { BIGINT, DT3, INT, POS, col, decimal, edge, fromTable, pattern, varchar } from './dsl.js';

const MOVE = [
  { sql: 'UPDATE account SET balance = balance - :amount WHERE account_id = :src' },
  { sql: 'UPDATE account SET balance = balance + :amount WHERE account_id = :dst' },
  { sql: 'INSERT INTO transfer (from_id, to_id, amount) VALUES (:src, :dst, :amount)' },
];
// `unordered` (the naive variant) locks the source row first, then the destination: opposite transfers deadlock.
// `ordered` (the pessimistic variant) locks LEAST(id) then GREATEST(id): every transaction acquires locks in the same order.
const unordered = MOVE;
const ordered = [
  { sql: 'SELECT account_id FROM account WHERE account_id = LEAST(:src, :dst) FOR UPDATE' },
  { sql: 'SELECT account_id FROM account WHERE account_id = GREATEST(:src, :dst) FOR UPDATE' },
  ...MOVE,
];

export function buildBankTransfers(): DesignDoc {
  return DesignDoc.parse({
    seed: 23,
    nodes: [
      { id: 'users', type: 'users', name: 'Tellers', position: POS.users, config: { vus: 100, thinkMinMs: 5, thinkMaxMs: 20, thinkDist: 'uniform', pattern: 'constant', durationS: 20, warmupS: 3 } },
      { id: 'app', type: 'app', name: 'App server', position: { x: 272, y: 140 }, config: { instances: 1, workers: 64, processingMeanMs: 1, processingJitterMs: 1, poolSize: 32, strategy: 'naive', retry: { max: 5, backoffMs: 5 } } },
      { id: 'db', type: 'mysql', name: 'MySQL', position: { x: 560, y: 140 }, config: { isolation: 'REPEATABLE READ', lockWaitTimeoutS: 3, maxExecutionTimeMs: 0 } },
    ],
    edges: [edge('users', 'app', 1), edge('app', 'db', 1)],
    schema: {
      tables: [
        {
          name: 'account', seedRows: 200, position: { x: 0, y: 0 }, primaryKey: ['account_id'],
          columns: [
            col('account_id', INT, { ai: true }),
            col('holder', varchar(80), { seed: { kind: 'personName' } }),
            col('balance', decimal(14, 2), { seed: { kind: 'constant', value: 1000 } }),
          ],
          checks: [{ name: 'ck_account_balance', expr: '`balance` >= 0' }],
        },
        {
          name: 'transfer', seedRows: 0, position: { x: 288, y: 0 }, primaryKey: ['transfer_id'],
          columns: [
            col('transfer_id', BIGINT, { ai: true }),
            col('from_id', INT),
            col('to_id', INT),
            col('amount', decimal(14, 2)),
            col('created_at', DT3, { def: { expr: 'CURRENT_TIMESTAMP(3)' } }),
          ],
          foreignKeys: [
            { columns: ['from_id'], refTable: 'account', refColumns: ['account_id'] },
            { columns: ['to_id'], refTable: 'account', refColumns: ['account_id'] },
          ],
          checks: [{ name: 'ck_transfer_distinct', expr: '`from_id` <> `to_id`' }, { name: 'ck_transfer_amount', expr: '`amount` > 0' }],
        },
        {
          // Every account opens with `opening_balance`, so SUM(balance) = COUNT(*) * opening_balance whatever the row scale.
          name: 'bank_meta', seedRows: 1, position: { x: 0, y: 300 }, primaryKey: ['k'],
          columns: [
            col('k', varchar(30), { seed: pattern('opening_balance') }),
            col('v', decimal(14, 2), { seed: { kind: 'constant', value: 1000 } }),
          ],
        },
      ],
    },
    workload: {
      transactions: [
        {
          name: 'transfer', weight: 90, readOnly: false, cacheable: false,
          description: 'Move money between two accounts. Both ends follow a zipf distribution, so opposite transfers collide.',
          params: {
            src: fromTable('account', 'account_id', 'zipf', 1.2), dst: fromTable('account', 'account_id', 'zipf', 1.2),
            amount: { kind: 'decimalRange', min: 1, max: 40, scale: 2 },
          },
          variants: { default: unordered, naive: unordered, pessimistic: ordered },
        },
        {
          name: 'audit_balance', weight: 10, readOnly: true, cacheable: false,
          description: 'Sum all balances (auditor).',
          params: {},
          variants: { default: [{ sql: 'SELECT SUM(balance) AS total FROM account' }] },
        },
      ],
      invariants: [
        {
          name: 'money_conserved', description: 'Total balance still equals accounts x opening balance.',
          sql: "SELECT COUNT(*) AS violations FROM (SELECT SUM(balance) AS total, COUNT(*) AS n FROM account) s JOIN bank_meta m ON m.k = 'opening_balance' WHERE s.total <> s.n * m.v",
        },
      ],
    },
    slo: { p95Ms: 200, maxErrorPct: 1, perTxn: {} },
  });
}
