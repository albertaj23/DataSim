import { DesignDoc } from '@datasim/shared';
import { BIGINT, DT3, INT, POS, col, decimal, edge, enumOf, fromTable, pattern, pick, uniformInt, varchar } from './dsl.js';

const GUARD = { left: '$p.stock', op: '>=' as const, right: ':qty', onFail: 'reject' as const };
const READ_PRODUCT = (lock = '') => `SELECT stock, price FROM product WHERE product_id = :pid${lock}`;
const DECREMENT = 'UPDATE product SET stock = stock - :qty WHERE product_id = :pid';
const PLACE_ORDER = [
  { sql: "INSERT INTO orders (customer_id, status, total) SELECT :customer, 'PAID', price * :qty FROM product WHERE product_id = :pid" },
  { sql: 'SELECT LAST_INSERT_ID() AS id', bindAs: 'o' },
  { sql: 'INSERT INTO order_item (order_id, product_id, qty, unit_price) SELECT :$o.id, product_id, :qty, price FROM product WHERE product_id = :pid' },
];

// Check-then-act: the read and the decrement are separate statements, so concurrent buyers all see "enough stock".
const naive = [{ sql: READ_PRODUCT(), bindAs: 'p', guard: GUARD }, { sql: DECREMENT }, ...PLACE_ORDER];

export function buildFlashSale(): DesignDoc {
  return DesignDoc.parse({
    seed: 11,
    nodes: [
      { id: 'users', type: 'users', name: 'Shoppers', position: POS.users, config: { vus: 120, thinkMinMs: 20, thinkMaxMs: 60, thinkDist: 'uniform', pattern: 'spike', durationS: 20, warmupS: 3 } },
      { id: 'app', type: 'app', name: 'App servers', position: { x: 320, y: 140 }, config: { instances: 2, workers: 32, processingMeanMs: 2, processingJitterMs: 1, poolSize: 16, strategy: 'naive', retry: { max: 3, backoffMs: 5 } } },
      { id: 'cache', type: 'redis', name: 'Redis cache', position: { x: 680, y: 20 }, config: { ttlS: 10 } },
      { id: 'db', type: 'mysql', name: 'MySQL', position: { x: 680, y: 260 }, config: { isolation: 'REPEATABLE READ', lockWaitTimeoutS: 3, maxExecutionTimeMs: 0 } },
    ],
    edges: [edge('users', 'app', 2), edge('app', 'cache', 1), edge('app', 'db', 1)],
    schema: {
      tables: [
        {
          // No CHECK (stock >= 0) on purpose: adding it is the constraint strategy the advisor suggests.
          name: 'product', seedRows: 100, position: { x: 0, y: 0 }, primaryKey: ['product_id'],
          columns: [
            col('product_id', INT, { ai: true }),
            col('sku', varchar(20), { seed: pattern('SKU-#####') }),
            col('name', varchar(80), { seed: pattern('Product ####') }),
            col('price', decimal(10, 2), { seed: { kind: 'decimalRange', min: 5, max: 500, scale: 2 } }),
            col('initial_stock', INT, { seed: uniformInt(30, 80) }),
            col('stock', INT, { seed: { kind: 'expression', expr: 'initial_stock' } }),
          ],
          uniques: [{ name: 'uq_product_sku', columns: ['sku'] }],
        },
        {
          name: 'customer', seedRows: 5000, position: { x: 0, y: 280 }, primaryKey: ['customer_id'],
          columns: [
            col('customer_id', INT, { ai: true }),
            col('name', varchar(80), { seed: { kind: 'personName' } }),
            col('email', varchar(120), { seed: { kind: 'email', domain: 'example.edu', from: 'name' } }),
          ],
        },
        {
          name: 'orders', seedRows: 0, position: { x: 340, y: 280 }, primaryKey: ['order_id'],
          columns: [
            col('order_id', BIGINT, { ai: true }),
            col('customer_id', INT),
            col('status', enumOf('PAID', 'CANCELLED')),
            col('total', decimal(12, 2)),
            col('created_at', DT3, { def: { expr: 'CURRENT_TIMESTAMP(3)' } }),
          ],
          foreignKeys: [{ columns: ['customer_id'], refTable: 'customer', refColumns: ['customer_id'] }],
        },
        {
          name: 'order_item', seedRows: 0, position: { x: 340, y: 0 }, primaryKey: ['order_id', 'product_id'],
          columns: [
            col('order_id', BIGINT),
            col('product_id', INT),
            col('qty', INT),
            col('unit_price', decimal(10, 2)),
          ],
          foreignKeys: [
            { columns: ['order_id'], refTable: 'orders', refColumns: ['order_id'] },
            { columns: ['product_id'], refTable: 'product', refColumns: ['product_id'] },
          ],
          checks: [{ name: 'ck_order_item_qty', expr: '`qty` > 0' }],
        },
      ],
    },
    workload: {
      transactions: [
        {
          name: 'checkout', weight: 60, readOnly: false, cacheable: false,
          description: 'Buy qty units of one SKU. Hot SKUs follow a zipf distribution, so a few products sell out first.',
          params: { customer: fromTable('customer', 'customer_id'), pid: fromTable('product', 'product_id', 'zipf', 1.3), qty: pick([1, 2, 3], [0.6, 0.3, 0.1]) },
          variants: {
            default: naive,
            naive,
            pessimistic: [{ sql: READ_PRODUCT(' FOR UPDATE'), bindAs: 'p', guard: GUARD }, { sql: DECREMENT }, ...PLACE_ORDER],
            atomic: [
              { sql: 'UPDATE product SET stock = stock - :qty WHERE product_id = :pid AND stock >= :qty', expectAffected: { op: '=', value: 1, onFail: 'reject' } },
              ...PLACE_ORDER,
            ],
          },
        },
        {
          name: 'view_product', weight: 40, readOnly: true, cacheable: true,
          description: 'Product page: price and remaining stock (cacheable, so it can show stale stock).',
          params: { pid: fromTable('product', 'product_id', 'zipf', 1.3) },
          variants: { default: [{ sql: 'SELECT product_id, name, price, stock FROM product WHERE product_id = :pid' }] },
        },
      ],
      invariants: [
        { name: 'stock_non_negative', description: 'No product is oversold (stock below zero).', sql: 'SELECT COUNT(*) AS violations FROM product WHERE stock < 0' },
        {
          name: 'stock_conserved', description: 'initial_stock - stock equals the quantity in order_item for every product.',
          sql: 'SELECT COUNT(*) AS violations FROM product p WHERE p.initial_stock - p.stock <> COALESCE((SELECT SUM(oi.qty) FROM order_item oi WHERE oi.product_id = p.product_id), 0)',
        },
      ],
    },
    slo: { p95Ms: 200, maxErrorPct: 1, perTxn: {} },
  });
}
