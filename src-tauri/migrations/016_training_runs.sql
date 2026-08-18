PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS training_runs (
  id TEXT PRIMARY KEY NOT NULL,
  run_number INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('Planned','Running','Paused','Interrupted','Completed')),
  record_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_training_runs_recent ON training_runs(run_number DESC);
