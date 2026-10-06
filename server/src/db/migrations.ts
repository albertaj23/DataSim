import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2/promise';
import { appPool } from './pool.js';

const migrations = [
  { version: 1, file: new URL('../../../db/migrations/001_scenario_workspaces.sql', import.meta.url) },
  { version: 2, file: new URL('../../../db/migrations/002_scenario_unique_constraints.sql', import.meta.url) },
  { version: 3, file: new URL('../../../db/migrations/003_scenario_experiment_batches.sql', import.meta.url) },
  { version: 4, file: new URL('../../../db/migrations/004_scenario_batch_finished_cells.sql', import.meta.url) },
];

export async function runScenarioMigrations(): Promise<void> {
  await appPool.query(
    `CREATE TABLE IF NOT EXISTS scenario_schema_migration (
      version INT UNSIGNED PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`,
  );
  for (const migration of migrations) {
    const [applied] = await appPool.query<Array<RowDataPacket & { version: number }>>(
      'SELECT version FROM scenario_schema_migration WHERE version = ?',
      [migration.version],
    );
    if (applied.length > 0) continue;
    const sql = await readFile(fileURLToPath(migration.file), 'utf8');
    const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean);
    if (migration.version === 4) {
      const [columns] = await appPool.query<Array<RowDataPacket & { COLUMN_NAME: string }>>(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        ['scenario_experiment_batch', 'finished_cells'],
      );
      if (columns.length > 0 && statements[0]?.startsWith('ALTER TABLE scenario_experiment_batch')) statements.shift();
    }
    for (const statement of statements) await appPool.query(statement);
    await appPool.query('INSERT INTO scenario_schema_migration (version) VALUES (?)', [migration.version]);
    console.info(`Applied scenario workspace database migration ${migration.version}.`);
  }
  await appPool.query(
    `UPDATE scenario_run
     SET status = 'FAILED', error_message = 'Server restarted before this run completed.', finished_at = NOW(3)
     WHERE status IN ('QUEUED', 'RUNNING')`,
  );
  await appPool.query(
    `UPDATE scenario_experiment_cell
     SET status = CASE WHEN status = 'RUNNING' THEN 'FAILED' ELSE 'CANCELLED' END,
         error_message = 'Server restarted before this experiment cell completed.',
         finished_at = NOW(3)
     WHERE status IN ('QUEUED', 'RUNNING')`,
  );
  await appPool.query(
    `UPDATE scenario_experiment_batch
     SET status = CASE WHEN completed_cells > 0 THEN 'PARTIAL' ELSE 'FAILED' END,
         finished_cells = total_cells,
         error_message = 'Server restarted before this experiment batch completed.',
         finished_at = NOW(3)
     WHERE status IN ('QUEUED', 'RUNNING')`,
  );
}
