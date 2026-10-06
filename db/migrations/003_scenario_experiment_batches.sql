CREATE TABLE IF NOT EXISTS scenario_experiment_batch (
  batch_id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  revision INT UNSIGNED NOT NULL,
  revision_hash CHAR(64) NOT NULL,
  definition_snapshot JSON NOT NULL,
  configuration JSON NOT NULL,
  engine VARCHAR(40) NOT NULL,
  engine_version VARCHAR(80) NOT NULL,
  status ENUM('QUEUED','RUNNING','COMPLETED','FAILED','PARTIAL','CANCELLED') NOT NULL,
  total_cells SMALLINT UNSIGNED NOT NULL,
  completed_cells SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  INDEX ix_scenario_batch_workspace (workspace_id, created_at),
  INDEX ix_scenario_batch_status (status, created_at),
  CONSTRAINT fk_scenario_batch_revision FOREIGN KEY (workspace_id, revision)
    REFERENCES scenario_revision(workspace_id, revision) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scenario_experiment_cell (
  batch_id CHAR(36) NOT NULL,
  cell_index SMALLINT UNSIGNED NOT NULL,
  concurrency_level TINYINT UNSIGNED NOT NULL,
  isolation_level ENUM('READ COMMITTED','REPEATABLE READ','SERIALIZABLE') NOT NULL,
  run_id CHAR(36) NULL,
  status ENUM('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED') NOT NULL,
  trials_completed SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  p50_ms DECIMAL(16,3) NULL,
  p95_ms DECIMAL(16,3) NULL,
  violations INT UNSIGNED NULL,
  error_message VARCHAR(1000) NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (batch_id, cell_index),
  UNIQUE KEY uq_scenario_batch_configuration (batch_id, concurrency_level, isolation_level),
  UNIQUE KEY uq_scenario_batch_run (run_id),
  CONSTRAINT fk_scenario_cell_batch FOREIGN KEY (batch_id)
    REFERENCES scenario_experiment_batch(batch_id) ON DELETE CASCADE,
  CONSTRAINT fk_scenario_cell_run FOREIGN KEY (run_id)
    REFERENCES scenario_run(run_id) ON DELETE RESTRICT
) ENGINE=InnoDB;
