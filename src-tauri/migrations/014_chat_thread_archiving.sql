PRAGMA foreign_keys = ON;

ALTER TABLE chat_threads ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_threads_workspace_mode_recent
  ON chat_threads(workspace_id, mode, archived_at, updated_at DESC);
