ALTER TABLE workspace_sources ADD COLUMN content_text TEXT;

CREATE TABLE IF NOT EXISTS chat_thread_sources (
  thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES workspace_sources(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(thread_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_thread_sources_thread ON chat_thread_sources(thread_id, active);
