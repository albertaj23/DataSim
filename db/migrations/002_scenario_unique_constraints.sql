CREATE TABLE IF NOT EXISTS scenario_run_unique_value (
  run_id CHAR(36) NOT NULL,
  trial_no SMALLINT UNSIGNED NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  field_id VARCHAR(64) NOT NULL,
  value_hash CHAR(64) NOT NULL,
  row_key VARCHAR(255) NOT NULL,
  PRIMARY KEY (run_id, trial_no, entity_id, field_id, value_hash),
  INDEX ix_scenario_unique_row (run_id, trial_no, entity_id, row_key),
  CONSTRAINT fk_scenario_unique_run FOREIGN KEY (run_id)
    REFERENCES scenario_run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;
