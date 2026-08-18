CREATE TABLE IF NOT EXISTS chat_thread_groups (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('conversation', 'manual_rv')),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

ALTER TABLE chat_threads ADD COLUMN thread_group_id TEXT REFERENCES chat_thread_groups(id);

INSERT OR IGNORE INTO chat_thread_groups (id, workspace_id, mode, title, created_at, updated_at)
SELECT 'legacy_group_' || workspace_id || '_' || mode,
       workspace_id,
       mode,
       'Thread 1',
       MIN(created_at),
       MAX(updated_at)
  FROM chat_threads
 GROUP BY workspace_id, mode;

UPDATE chat_threads
   SET thread_group_id = 'legacy_group_' || workspace_id || '_' || mode
 WHERE thread_group_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_thread_groups_workspace_mode_recent
  ON chat_thread_groups(workspace_id, mode, archived_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_threads_group_recent
  ON chat_threads(thread_group_id, archived_at, updated_at DESC);
