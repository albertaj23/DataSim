-- DataSim v2 meta schema. Design notes and functional dependencies: docs/DATABASE_DESIGN.md.
-- JSON is used only for the editor document (design_json, read and written whole). Everything queried or compared is relational.

CREATE TABLE IF NOT EXISTS project (
  project_id   CHAR(36)     NOT NULL,
  name         VARCHAR(120) NOT NULL,
  description  VARCHAR(500) NOT NULL DEFAULT '',
  template_key VARCHAR(40)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  archived_at  DATETIME(3)  NULL,
  PRIMARY KEY (project_id),
  INDEX ix_project_updated (archived_at, updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS project_draft (
  project_id  CHAR(36)    NOT NULL,
  design_json JSON        NOT NULL,
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (project_id),
  CONSTRAINT fk_draft_project FOREIGN KEY (project_id) REFERENCES project(project_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS design_revision (
  project_id   CHAR(36)    NOT NULL,
  revision_no  INT UNSIGNED NOT NULL,
  design_json  JSON        NOT NULL,
  content_hash CHAR(64)    NOT NULL,
  note         VARCHAR(200) NOT NULL DEFAULT '',
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (project_id, revision_no),
  UNIQUE KEY uq_revision_hash (project_id, content_hash),
  CONSTRAINT fk_revision_project FOREIGN KEY (project_id) REFERENCES project(project_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS run (
  run_id           CHAR(36)    NOT NULL,
  project_id       CHAR(36)    NOT NULL,
  revision_no      INT UNSIGNED NOT NULL,
  kind             ENUM('LOAD','CAPACITY','STRATEGY_CHILD') NOT NULL,
  parent_run_id    CHAR(36)    NULL,
  status           ENUM('QUEUED','PROVISIONING','WARMING','RUNNING','ANALYZING','COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'QUEUED',
  settings_json    JSON        NOT NULL,
  strategy         VARCHAR(24) NOT NULL,
  isolation_level  VARCHAR(20) NOT NULL,
  vus              INT UNSIGNED NOT NULL,
  duration_s       INT UNSIGNED NOT NULL,
  seed             INT         NOT NULL,
  mysql_version    VARCHAR(40) NULL,
  started_at       DATETIME(3) NULL,
  finished_at      DATETIME(3) NULL,
  txn_total        INT UNSIGNED NOT NULL DEFAULT 0,
  committed        INT UNSIGNED NOT NULL DEFAULT 0,
  rejected         INT UNSIGNED NOT NULL DEFAULT 0,
  errored          INT UNSIGNED NOT NULL DEFAULT 0,
  retries          INT UNSIGNED NOT NULL DEFAULT 0,
  deadlocks        INT UNSIGNED NOT NULL DEFAULT 0,
  lock_timeouts    INT UNSIGNED NOT NULL DEFAULT 0,
  tps_avg          DECIMAL(12,2) NOT NULL DEFAULT 0,
  p50_ms           DECIMAL(12,2) NOT NULL DEFAULT 0,
  p95_ms           DECIMAL(12,2) NOT NULL DEFAULT 0,
  p99_ms           DECIMAL(12,2) NOT NULL DEFAULT 0,
  cache_hit_ratio  DECIMAL(6,4) NULL,
  slo_pass         BOOLEAN     NULL,
  slo_reasons_json JSON        NULL,
  bottleneck_json  JSON        NULL,
  error_text       VARCHAR(1000) NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (run_id),
  INDEX ix_run_project_started (project_id, created_at),
  INDEX ix_run_parent (parent_run_id),
  CONSTRAINT fk_run_revision FOREIGN KEY (project_id, revision_no) REFERENCES design_revision(project_id, revision_no),
  CONSTRAINT fk_run_parent FOREIGN KEY (parent_run_id) REFERENCES run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS run_sample (
  run_id          CHAR(36) NOT NULL,
  t_s             INT UNSIGNED NOT NULL,
  tps             DECIMAL(12,2) NOT NULL,
  p50_ms          DECIMAL(12,2) NOT NULL,
  p95_ms          DECIMAL(12,2) NOT NULL,
  p99_ms          DECIMAL(12,2) NOT NULL,
  errors          INT UNSIGNED NOT NULL,
  active_vus      INT UNSIGNED NOT NULL,
  app_queue       INT UNSIGNED NOT NULL,
  pool_waiting    INT UNSIGNED NOT NULL,
  threads_running INT UNSIGNED NOT NULL,
  row_lock_waits  INT UNSIGNED NOT NULL,
  lock_wait_ms    DECIMAL(12,2) NOT NULL,
  bp_hit_ratio    DECIMAL(6,4) NULL,
  cache_hit_ratio DECIMAL(6,4) NULL,
  retries         INT UNSIGNED NOT NULL DEFAULT 0,
  deadlocks       INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, t_s),
  CONSTRAINT fk_sample_run FOREIGN KEY (run_id) REFERENCES run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS run_txn_stat (
  run_id    CHAR(36)    NOT NULL,
  txn_name  VARCHAR(64) NOT NULL,
  `count`   INT UNSIGNED NOT NULL,
  committed INT UNSIGNED NOT NULL,
  rejected  INT UNSIGNED NOT NULL,
  errored   INT UNSIGNED NOT NULL,
  retries   INT UNSIGNED NOT NULL,
  deadlocks INT UNSIGNED NOT NULL,
  p50_ms    DECIMAL(12,2) NOT NULL,
  p95_ms    DECIMAL(12,2) NOT NULL,
  p99_ms    DECIMAL(12,2) NOT NULL,
  mean_ms   DECIMAL(12,2) NOT NULL,
  queue_ms  DECIMAL(12,3) NOT NULL,
  net_ms    DECIMAL(12,3) NOT NULL,
  app_ms    DECIMAL(12,3) NOT NULL,
  pool_ms   DECIMAL(12,3) NOT NULL,
  db_ms     DECIMAL(12,3) NOT NULL,
  PRIMARY KEY (run_id, txn_name),
  CONSTRAINT fk_txnstat_run FOREIGN KEY (run_id) REFERENCES run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS run_statement_stat (
  run_id        CHAR(36)  NOT NULL,
  digest        CHAR(64)  NOT NULL,
  digest_text   TEXT      NOT NULL,
  txn_name      VARCHAR(64) NULL,
  exec_count    BIGINT UNSIGNED NOT NULL,
  avg_ms        DECIMAL(12,3) NOT NULL,
  max_ms        DECIMAL(12,3) NOT NULL,
  rows_examined BIGINT UNSIGNED NOT NULL,
  rows_sent     BIGINT UNSIGNED NOT NULL,
  rows_affected BIGINT UNSIGNED NOT NULL,
  no_index_used BIGINT UNSIGNED NOT NULL,
  lock_time_ms  DECIMAL(14,3) NOT NULL,
  explain_json  JSON NULL,
  PRIMARY KEY (run_id, digest),
  CONSTRAINT fk_stmtstat_run FOREIGN KEY (run_id) REFERENCES run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS run_lock_wait (
  run_id       CHAR(36)     NOT NULL,
  seq          INT UNSIGNED NOT NULL,
  at_ms        INT UNSIGNED NOT NULL,
  waiting_txn  VARCHAR(64)  NOT NULL,
  blocking_txn VARCHAR(64)  NOT NULL,
  table_name   VARCHAR(64)  NOT NULL,
  index_name   VARCHAR(64)  NULL,
  lock_mode    VARCHAR(32)  NOT NULL,
  lock_data    VARCHAR(255) NULL,
  PRIMARY KEY (run_id, seq),
  CONSTRAINT fk_lockwait_run FOREIGN KEY (run_id) REFERENCES run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS run_invariant (
  run_id         CHAR(36)    NOT NULL,
  invariant_name VARCHAR(64) NOT NULL,
  description    VARCHAR(500) NOT NULL DEFAULT '',
  sql_text       TEXT        NOT NULL,
  violations     BIGINT UNSIGNED NOT NULL,
  passed         BOOLEAN     NOT NULL,
  error_text     VARCHAR(500) NULL,
  PRIMARY KEY (run_id, invariant_name),
  CONSTRAINT fk_invariant_run FOREIGN KEY (run_id) REFERENCES run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS run_finding (
  run_id        CHAR(36)    NOT NULL,
  finding_no    INT UNSIGNED NOT NULL,
  severity      ENUM('HIGH','MEDIUM','LOW','INFO') NOT NULL,
  kind          VARCHAR(32) NOT NULL,
  title         VARCHAR(200) NOT NULL,
  explanation   TEXT        NOT NULL,
  evidence_json JSON        NOT NULL,
  fix_json      JSON        NULL,
  fix_label     VARCHAR(120) NULL,
  PRIMARY KEY (run_id, finding_no),
  CONSTRAINT fk_finding_run FOREIGN KEY (run_id) REFERENCES run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS capacity_point (
  run_id     CHAR(36)     NOT NULL,
  step_no    INT UNSIGNED NOT NULL,
  vus        INT UNSIGNED NOT NULL,
  tps        DECIMAL(12,2) NOT NULL,
  p50_ms     DECIMAL(12,2) NOT NULL,
  p95_ms     DECIMAL(12,2) NOT NULL,
  error_rate DECIMAL(8,5) NOT NULL,
  PRIMARY KEY (run_id, step_no),
  CONSTRAINT fk_cappoint_run FOREIGN KEY (run_id) REFERENCES run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS capacity_fit (
  run_id        CHAR(36) NOT NULL,
  sigma         DOUBLE   NOT NULL,
  kappa         DOUBLE   NOT NULL,
  lambda_       DOUBLE   NOT NULL,
  n_peak        DOUBLE   NOT NULL,
  x_max         DOUBLE   NOT NULL,
  r2            DOUBLE   NOT NULL,
  knee_vus      INT UNSIGNED NULL,
  sustained_vus INT UNSIGNED NULL,
  sentence      VARCHAR(500) NOT NULL,
  PRIMARY KEY (run_id),
  CONSTRAINT fk_capfit_run FOREIGN KEY (run_id) REFERENCES run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;
