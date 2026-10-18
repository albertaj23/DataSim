import type { DesignDoc, NodeType, Transaction } from './design';
import type { Problem } from './problems';
import { IDENT_RE } from './schema';

/** Packet-Tracer-style connection rules, enforced while dragging and again at validation time. */
export const ALLOWED_TARGETS: Record<NodeType, readonly NodeType[]> = {
  users: ['lb', 'app'],
  lb: ['app'],
  app: ['redis', 'mysql'],
  redis: [],
  mysql: [],
};
export const MAX_TOTAL_POOL = 250;

export function canConnect(source: NodeType, target: NodeType): { ok: true } | { ok: false; reason: string } {
  if (ALLOWED_TARGETS[source].includes(target)) return { ok: true };
  if (source === 'redis' || source === 'mysql') return { ok: false, reason: `${source === 'mysql' ? 'MySQL' : 'Cache'} is a leaf: it has no outgoing connections` };
  const labels: Record<NodeType, string> = { users: 'Users', lb: 'Load balancer', app: 'App server', redis: 'Cache', mysql: 'Database' };
  return { ok: false, reason: `${labels[source]} cannot connect to ${labels[target]}. Allowed: ${ALLOWED_TARGETS[source].map((t) => labels[t]).join(', ') || 'none'}` };
}

/** Max nodes per type in Tier 1. */
export const NODE_LIMITS: Record<NodeType, number> = { users: 1, lb: 1, app: 4, redis: 1, mysql: 1 };

const SQL_START = /^\s*(select|insert|update|delete|with)\b/i;
const strip = (sql: string) => sql.replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, "''");

/** Extract `:param` and `:$bind.col` placeholders (outside string literals). */
export function extractPlaceholders(sql: string): { params: string[]; binds: Array<{ name: string; col: string }> } {
  const params = new Set<string>(); const binds: Array<{ name: string; col: string }> = [];
  for (const m of strip(sql).matchAll(/(?<!:):(\$([A-Za-z_]\w*)\.(\w+)|([A-Za-z_]\w*))/g)) {
    if (m[2]) binds.push({ name: m[2], col: m[3]! }); else params.add(m[4]!);
  }
  return { params: [...params], binds };
}

export function hasMultipleStatements(sql: string): boolean {
  const s = strip(sql).trim().replace(/;\s*$/, '');
  return s.includes(';');
}

export function strategyFor(txn: Transaction, strategy: string): string {
  return Object.prototype.hasOwnProperty.call(txn.variants, strategy) ? strategy : 'default';
}

/** Pure, static validation shared by the browser and the server (the server adds MySQL-based checks on top). */
export function validateDesign(design: DesignDoc): Problem[] {
  const out: Problem[] = [];
  const err = (code: string, message: string, path: Problem['path'] = {}) => out.push({ severity: 'error', code, message, path });
  const warn = (code: string, message: string, path: Problem['path'] = {}) => out.push({ severity: 'warning', code, message, path });

  // ---- topology
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  const count = (t: NodeType) => design.nodes.filter((n) => n.type === t).length;
  if (count('users') === 0) err('NO_USERS', 'Add a Users node: it defines the virtual users and the transaction mix');
  if (count('app') === 0) err('NO_APP', 'Add at least one App server');
  if (count('mysql') === 0) err('NO_DB', 'Add a Database node');
  for (const t of Object.keys(NODE_LIMITS) as NodeType[]) {
    if (count(t) > NODE_LIMITS[t]) err('TOO_MANY_NODES', `At most ${NODE_LIMITS[t]} ${t} node(s) are supported`);
  }
  for (const e of design.edges) {
    const s = byId.get(e.source); const t = byId.get(e.target);
    if (!s || !t) { err('DANGLING_EDGE', 'Edge references a missing node', { edgeId: e.id }); continue; }
    const r = canConnect(s.type, t.type);
    if (!r.ok) err('BAD_EDGE', r.reason, { edgeId: e.id });
  }
  const users = design.nodes.find((n) => n.type === 'users');
  const reach = new Set<string>();
  if (users) {
    const stack = [users.id]; reach.add(users.id);
    while (stack.length) { const id = stack.pop()!; for (const e of design.edges) if (e.source === id && !reach.has(e.target)) { reach.add(e.target); stack.push(e.target); } }
  }
  for (const n of design.nodes) {
    if (users && n.type !== 'users' && !reach.has(n.id)) warn('UNREACHABLE', `${n.name} is not reachable from Users`, { nodeId: n.id });
  }
  const mysql = design.nodes.find((n) => n.type === 'mysql');
  if (users && mysql && !reach.has(mysql.id)) err('DB_UNREACHABLE', 'Database is not reachable from Users: connect Users -> App -> Database', { nodeId: mysql.id });
  for (const a of design.nodes.filter((n) => n.type === 'app')) {
    if (!design.edges.some((e) => e.source === a.id && byId.get(e.target)?.type === 'mysql')) err('APP_NO_DB', `${a.name} is not connected to the database`, { nodeId: a.id });
  }
  const pool = design.nodes.reduce((sum, n) => sum + (n.type === 'app' ? n.config.instances * n.config.poolSize : 0), 0);
  if (pool > MAX_TOTAL_POOL) err('POOL_TOTAL', `Total pool connections ${pool} exceed the limit of ${MAX_TOTAL_POOL}`);

  // ---- schema
  const tables = new Map(design.schema.tables.map((t) => [t.name, t]));
  if (tables.size !== design.schema.tables.length) err('DUP_TABLE', 'Duplicate table names');
  for (const t of design.schema.tables) {
    const colNames = new Set(t.columns.map((c) => c.name));
    if (colNames.size !== t.columns.length) err('DUP_COLUMN', `Table ${t.name} has duplicate column names`, { table: t.name });
    const need = (list: string[], what: string) => list.filter((c) => !colNames.has(c)).forEach((c) => err('UNKNOWN_COLUMN', `${what} references unknown column ${t.name}.${c}`, { table: t.name, column: c }));
    need(t.primaryKey, 'Primary key');
    t.uniques.forEach((u) => need(u.columns, 'Unique constraint'));
    t.indexes.forEach((i) => need(i.columns, `Index ${i.name}`));
    t.foreignKeys.forEach((fk) => {
      need(fk.columns, 'Foreign key');
      const ref = tables.get(fk.refTable);
      if (!ref) { err('FK_UNKNOWN_TABLE', `Foreign key on ${t.name} references unknown table ${fk.refTable}`, { table: t.name }); return; }
      if (fk.columns.length !== fk.refColumns.length) err('FK_ARITY', `Foreign key ${t.name} -> ${fk.refTable} has mismatched column counts`, { table: t.name });
      const refCols = new Set(ref.columns.map((c) => c.name));
      fk.refColumns.filter((c) => !refCols.has(c)).forEach((c) => err('FK_UNKNOWN_COLUMN', `Foreign key references unknown column ${fk.refTable}.${c}`, { table: t.name, column: c }));
      const key = (cs: string[]) => cs.join(',');
      const covered = key(ref.primaryKey) === key(fk.refColumns) || ref.uniques.some((u) => key(u.columns) === key(fk.refColumns)) || ref.indexes.some((i) => i.unique && key(i.columns) === key(fk.refColumns));
      if (!covered) warn('FK_TARGET_NOT_UNIQUE', `${fk.refTable}(${fk.refColumns.join(', ')}) is not a PRIMARY KEY or UNIQUE key; MySQL may reject this foreign key`, { table: t.name });
    });
    t.columns.filter((c) => c.autoIncrement).forEach((c) => { if (!t.primaryKey.includes(c.name)) err('AI_NOT_KEY', `AUTO_INCREMENT column ${t.name}.${c.name} must be part of the primary key`, { table: t.name, column: c.name }); });
    t.columns.filter((c) => !IDENT_RE.test(c.name)).forEach((c) => err('BAD_IDENT', `Invalid column name ${c.name}`, { table: t.name, column: c.name }));
    t.columns.forEach((c) => {
      const g = c.seed;
      if (g?.kind === 'fkRef' && !tables.get(g.table)?.columns.some((x) => x.name === g.column)) err('SEED_FKREF', `Seed generator for ${t.name}.${c.name} references unknown ${g.table}.${g.column}`, { table: t.name, column: c.name });
    });
  }

  // ---- workload
  const txns = design.workload.transactions;
  if (txns.length === 0) err('NO_TXN', 'Define at least one transaction in the workload');
  else if (!txns.some((t) => t.weight > 0)) err('ZERO_WEIGHT', 'All transaction weights are 0');
  if (design.nodes.some((n) => n.type === 'redis') === false && txns.some((t) => t.cacheable)) warn('CACHE_UNUSED', 'Transactions are marked cacheable but there is no Cache node; reads go to the database');
  for (const t of txns) {
    for (const [variant, steps] of Object.entries(t.variants)) {
      const bound = new Set<string>();
      steps.forEach((s, i) => {
        const path = { txn: t.name, variant, step: i };
        if (!SQL_START.test(s.sql)) err('SQL_VERB', 'Statements must start with SELECT, INSERT, UPDATE, DELETE or WITH', path);
        if (hasMultipleStatements(s.sql)) err('SQL_MULTI', 'Multiple statements are not allowed', path);
        const ph = extractPlaceholders(s.sql);
        ph.params.filter((p) => !(p in t.params)).forEach((p) => err('UNKNOWN_PARAM', `Placeholder :${p} is not a parameter of ${t.name}`, path));
        ph.binds.filter((b) => !bound.has(b.name)).forEach((b) => err('UNKNOWN_BIND', `$${b.name} is used before any step binds it`, path));
        if (s.bindAs) bound.add(s.bindAs);
        for (const operand of [s.guard?.left, s.guard?.right]) {
          const m = operand?.match(/^\$([A-Za-z_]\w*)\./);
          if (m && !bound.has(m[1]!)) err('UNKNOWN_BIND', `Guard uses $${m[1]} before it is bound`, path);
        }
      });
    }
    if (t.readOnly) {
      for (const [variant, steps] of Object.entries(t.variants)) steps.forEach((s, i) => {
        if (!/^\s*(select|with)\b/i.test(s.sql)) err('READONLY_WRITES', `${t.name} is marked read-only but has a write statement`, { txn: t.name, variant, step: i });
      });
    }
  }
  const names = new Set<string>();
  for (const t of txns) { if (names.has(t.name)) err('DUP_TXN', `Duplicate transaction name ${t.name}`, { txn: t.name }); names.add(t.name); }
  for (const inv of design.workload.invariants) {
    if (!/^\s*(select|with)\b/i.test(inv.sql)) err('INV_SQL', `Invariant ${inv.name} must be a SELECT returning a single number`, { invariant: inv.name });
  }
  return out;
}
