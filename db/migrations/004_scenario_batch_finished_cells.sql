ALTER TABLE scenario_experiment_batch
  ADD COLUMN finished_cells SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER completed_cells;

UPDATE scenario_experiment_batch
SET finished_cells = (
  SELECT COUNT(*)
  FROM scenario_experiment_cell
  WHERE scenario_experiment_cell.batch_id = scenario_experiment_batch.batch_id
    AND scenario_experiment_cell.status IN ('COMPLETED', 'FAILED', 'CANCELLED')
);
