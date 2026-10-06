CREATE TABLE IF NOT EXISTS scenario_schema_migration (
  version INT UNSIGNED PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scenario_workspace (
  workspace_id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  current_revision INT UNSIGNED NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_activity_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX ix_scenario_workspace_recent (archived, last_activity_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scenario_revision (
  workspace_id CHAR(36) NOT NULL,
  revision INT UNSIGNED NOT NULL,
  schema_version SMALLINT UNSIGNED NOT NULL,
  definition JSON NOT NULL,
  content_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id, revision),
  CONSTRAINT fk_scenario_revision_workspace FOREIGN KEY (workspace_id)
    REFERENCES scenario_workspace(workspace_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scenario_run (
  run_id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  revision INT UNSIGNED NOT NULL,
  revision_hash CHAR(64) NOT NULL,
  definition_snapshot JSON NOT NULL,
  configuration JSON NOT NULL,
  run_mode ENUM('LIVE_DBMS','GUIDED_SCHEDULE','CONCEPT_MODEL') NOT NULL,
  engine VARCHAR(40) NOT NULL,
  engine_version VARCHAR(80) NOT NULL,
  status ENUM('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED') NOT NULL,
  seed INT UNSIGNED NOT NULL,
  summary JSON NULL,
  error_message VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  INDEX ix_scenario_run_workspace (workspace_id, created_at),
  INDEX ix_scenario_run_status (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scenario_run_event (
  run_id CHAR(36) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_id VARCHAR(64) NULL,
  observation_source ENUM('DBMS_OBSERVED','DATASIM_DERIVED','MODELED') NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sql_text TEXT NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (run_id, sequence_no),
  CONSTRAINT fk_scenario_event_run FOREIGN KEY (run_id)
    REFERENCES scenario_run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scenario_run_state (
  run_id CHAR(36) NOT NULL,
  trial_no SMALLINT UNSIGNED NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  row_key VARCHAR(255) NOT NULL,
  row_data JSON NOT NULL,
  PRIMARY KEY (run_id, trial_no, entity_id, row_key),
  CONSTRAINT fk_scenario_state_run FOREIGN KEY (run_id)
    REFERENCES scenario_run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;
