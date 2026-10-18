// Small pure helpers for the SQL console.

/** A query to start from: the first table, else a harmless probe. */
export function starterQuery(tableNames: string[]): string {
  return tableNames.length ? `SELECT * FROM \`${tableNames[0]}\` LIMIT 20` : 'SELECT 1';
}

/** True when the text is a SELECT / WITH / TABLE-style read that EXPLAIN can describe. */
export function isSelectLike(sql: string): boolean {
  return /^\s*(\(|select\b|with\b|explain\b)/i.test(sql);
}
