import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2/promise';
import { appPool } from './pool.js';

// 001-004 are the v1 scenario-workbench tables (kept so existing volumes keep migrating); 005 is the v2 meta schema.
const migrations = [
  { version: 1, file: '001_scenario_workspaces.sql' },
  { version: 2, file: '002_scenario_unique_constraints.sql' },
  { version: 3, file: '003_scenario_experiment_batches.sql' },
  { version: 4, file: '004_scenario_batch_finished_cells.sql' },
  { version: 5, file: '005_datasim_v2.sql' },
];

export async function runMigrations(): Promise<void> {
  await appPool.query(
    `CREATE TABLE IF NOT EXISTS scenario_schema_migration (
      version INT UNSIGNED PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`,
  );
  for (const migration of migrations) {
    const [applied] = await appPool.query<Array<RowDataPacket & { version: number }>>(
      'SELECT version FROM scenario_schema_migration WHERE version = ?', [migration.version]);
    if (applied.length > 0) continue;
    const sql = await readFile(fileURLToPath(new URL(`../../../db/migrations/${migration.file}`, import.meta.url)), 'utf8');
    const statements = sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean);
    if (migration.version === 4) {
      const [columns] = await appPool.query<Array<RowDataPacket & { COLUMN_NAME: string }>>(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        ['scenario_experiment_batch', 'finished_cells']);
      if (columns.length > 0 && statements[0]?.startsWith('ALTER TABLE scenario_experiment_batch')) statements.shift();
    }
    for (const statement of statements) await appPool.query(statement);
    await appPool.query('INSERT INTO scenario_schema_migration (version) VALUES (?)', [migration.version]);
    console.info(`Applied database migration ${migration.version} (${migration.file}).`);
  }
}
