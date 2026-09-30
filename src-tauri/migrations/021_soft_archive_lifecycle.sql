PRAGMA foreign_keys = ON;

ALTER TABLE rv_sessions ADD COLUMN archived_at TEXT;
ALTER TABLE training_runs ADD COLUMN archived_at TEXT;
ALTER TABLE research_projects ADD COLUMN archived_at TEXT;
ALTER TABLE targets ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_rv_sessions_archive_workspace
  ON rv_sessions(archived_at, workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_runs_archive
  ON training_runs(archived_at, run_number DESC);
CREATE INDEX IF NOT EXISTS idx_research_projects_archive_workspace
  ON research_projects(archived_at, workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_targets_archive_collection
  ON targets(collection, archived_at, updated_at DESC);
