CREATE TABLE IF NOT EXISTS target_clarifications (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES rv_sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_target_clarifications_session
ON target_clarifications(session_id, created_at);

CREATE TRIGGER IF NOT EXISTS prevent_target_clarification_before_reveal
BEFORE INSERT ON target_clarifications
WHEN COALESCE((SELECT state FROM rv_sessions WHERE id = NEW.session_id), '') NOT IN ('Revealed','Completed')
BEGIN
  SELECT RAISE(ABORT, 'target clarification is available only after Reveal');
END;

CREATE TRIGGER IF NOT EXISTS prevent_research_clarification_before_scores_frozen
BEFORE INSERT ON target_clarifications
WHEN EXISTS (
  SELECT 1
    FROM rv_sessions s
    LEFT JOIN research_projects p ON p.id = s.research_project_id
   WHERE s.id = NEW.session_id
     AND s.research_project_id IS NOT NULL
     AND p.scores_frozen_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Research target clarification requires frozen Judge scores');
END;

CREATE TRIGGER IF NOT EXISTS prevent_target_clarification_update
BEFORE UPDATE ON target_clarifications
BEGIN
  SELECT RAISE(ABORT, 'target clarifications are immutable supplementary records');
END;

CREATE TRIGGER IF NOT EXISTS prevent_target_clarification_delete
BEFORE DELETE ON target_clarifications
BEGIN
  SELECT RAISE(ABORT, 'target clarifications are immutable supplementary records');
END;
