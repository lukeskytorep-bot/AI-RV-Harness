PRAGMA foreign_keys = ON;

-- UX-DATA-8: Permanent Delete is intentionally separated from normal CRUD.
-- This table is used only inside one explicit database transaction. A committed database
-- must never retain a row here. Delete guards below stay active unless that transaction
-- has inserted id=1 and removes it again before COMMIT.
CREATE TABLE IF NOT EXISTS controlled_purge_context (
  id INTEGER PRIMARY KEY NOT NULL CHECK(id = 1),
  reason TEXT NOT NULL,
  started_at TEXT NOT NULL
);

-- Preserve a stable target identifier after a user-owned target record is deliberately purged.
-- The live FK may become NULL, while historical Session / Research records continue to expose
-- the identifier used at execution time.
ALTER TABLE rv_sessions ADD COLUMN target_id_snapshot TEXT;
UPDATE rv_sessions SET target_id_snapshot = target_id WHERE target_id_snapshot IS NULL AND target_id IS NOT NULL;

ALTER TABLE research_assignments ADD COLUMN target_id_snapshot TEXT;
UPDATE research_assignments SET target_id_snapshot = target_id WHERE target_id_snapshot IS NULL AND target_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS capture_rv_session_target_snapshot
AFTER INSERT ON rv_sessions
WHEN NEW.target_id IS NOT NULL AND NEW.target_id_snapshot IS NULL
BEGIN
  UPDATE rv_sessions SET target_id_snapshot = NEW.target_id WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS capture_research_assignment_target_snapshot
AFTER INSERT ON research_assignments
WHEN NEW.target_id IS NOT NULL AND NEW.target_id_snapshot IS NULL
BEGIN
  UPDATE research_assignments SET target_id_snapshot = NEW.target_id WHERE id = NEW.id;
END;

-- Normal immutability remains unchanged. Only the dedicated transaction may delete records
-- that are intentionally immutable during ordinary application operation.
DROP TRIGGER IF EXISTS prevent_snapshot_delete;
CREATE TRIGGER prevent_snapshot_delete
BEFORE DELETE ON session_snapshots
WHEN NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'session snapshots are immutable');
END;

DROP TRIGGER IF EXISTS prevent_frozen_score_delete;
CREATE TRIGGER prevent_frozen_score_delete
BEFORE DELETE ON judge_scores
WHEN OLD.frozen_at IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'frozen Judge result is immutable');
END;

DROP TRIGGER IF EXISTS prevent_frozen_judge_run_delete;
CREATE TRIGGER prevent_frozen_judge_run_delete
BEFORE DELETE ON judge_runs
WHEN EXISTS (
  SELECT 1 FROM judge_scores s WHERE s.judge_run_id = OLD.id AND s.frozen_at IS NOT NULL
)
 AND NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'Judge run with frozen score is immutable');
END;

DROP TRIGGER IF EXISTS prevent_locked_condition_delete;
CREATE TRIGGER prevent_locked_condition_delete
BEFORE DELETE ON research_conditions
WHEN EXISTS (SELECT 1 FROM research_projects p WHERE p.id = OLD.research_project_id AND p.locked_at IS NOT NULL)
 AND NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'locked Research conditions are immutable');
END;

DROP TRIGGER IF EXISTS prevent_locked_assignment_plan_update;
CREATE TRIGGER prevent_locked_assignment_plan_update
BEFORE UPDATE OF research_project_id, anonymous_session_id, target_id, execution_order, judge_order ON research_assignments
WHEN EXISTS (SELECT 1 FROM research_projects p WHERE p.id = OLD.research_project_id AND p.locked_at IS NOT NULL)
 AND NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'locked Research assignment plan is immutable');
END;

DROP TRIGGER IF EXISTS prevent_locked_assignment_delete;
CREATE TRIGGER prevent_locked_assignment_delete
BEFORE DELETE ON research_assignments
WHEN EXISTS (SELECT 1 FROM research_projects p WHERE p.id = OLD.research_project_id AND p.locked_at IS NOT NULL)
 AND NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'locked Research assignments are immutable');
END;

DROP TRIGGER IF EXISTS prevent_locked_blinding_delete;
CREATE TRIGGER prevent_locked_blinding_delete
BEFORE DELETE ON blinding_mappings
WHEN EXISTS (SELECT 1 FROM research_projects p WHERE p.id = OLD.research_project_id AND p.locked_at IS NOT NULL)
 AND NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'Blinding Key is immutable after Experiment Lock');
END;

DROP TRIGGER IF EXISTS prevent_research_result_delete;
CREATE TRIGGER prevent_research_result_delete
BEFORE DELETE ON research_results
WHEN NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'Research results are immutable');
END;

DROP TRIGGER IF EXISTS prevent_target_clarification_delete;
CREATE TRIGGER prevent_target_clarification_delete
BEFORE DELETE ON target_clarifications
WHEN NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'target clarifications are immutable supplementary records');
END;

-- Factory/training targets remain absolutely non-deletable. Only the used-user-target guard
-- can be bypassed by the controlled purge transaction.
DROP TRIGGER IF EXISTS prevent_used_target_delete;
CREATE TRIGGER prevent_used_target_delete
BEFORE DELETE ON targets
WHEN (
  EXISTS (SELECT 1 FROM target_usage WHERE target_id = OLD.id)
  OR EXISTS (SELECT 1 FROM rv_sessions WHERE target_id = OLD.id)
  OR EXISTS (SELECT 1 FROM research_assignments WHERE target_id = OLD.id)
)
 AND NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'used targets are locked to preserve session and Research integrity');
END;

-- Viewer Notes are append-only in normal operation. Profile purge is the one lifecycle action
-- that may remove the entire AI identity and its Notes history. Source Session/Workspace purge
-- still uses ON DELETE SET NULL and preserves these rows.
DROP TRIGGER IF EXISTS ai_note_versions_append_only_update;
CREATE TRIGGER ai_note_versions_append_only_update
BEFORE UPDATE ON ai_note_versions
WHEN NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
 AND NOT (
  NEW.id IS OLD.id
  AND NEW.ai_identity_id IS OLD.ai_identity_id
  AND NEW.version_number IS OLD.version_number
  AND NEW.content IS OLD.content
  AND NEW.content_sha256 IS OLD.content_sha256
  AND NEW.estimated_tokens IS OLD.estimated_tokens
  AND NEW.estimator_version IS OLD.estimator_version
  AND NEW.capacity_tokens_at_creation IS OLD.capacity_tokens_at_creation
  AND (NEW.source_session_id IS OLD.source_session_id OR (OLD.source_session_id IS NOT NULL AND NEW.source_session_id IS NULL))
  AND (NEW.source_workspace_id IS OLD.source_workspace_id OR (OLD.source_workspace_id IS NOT NULL AND NEW.source_workspace_id IS NULL))
  AND NEW.source_snapshot_json IS OLD.source_snapshot_json
  AND NEW.protocol_id IS OLD.protocol_id
  AND NEW.session_run_type IS OLD.session_run_type
  AND NEW.change_summary IS OLD.change_summary
  AND NEW.base_version_id IS OLD.base_version_id
  AND NEW.base_content_sha256 IS OLD.base_content_sha256
  AND NEW.reflection_run_id IS OLD.reflection_run_id
  AND NEW.reflection_packet_sha256 IS OLD.reflection_packet_sha256
  AND NEW.model_route_snapshot IS OLD.model_route_snapshot
  AND NEW.generation_settings_json IS OLD.generation_settings_json
  AND NEW.upstream_provider_snapshot IS OLD.upstream_provider_snapshot
  AND NEW.created_at IS OLD.created_at
 )
BEGIN
  SELECT RAISE(ABORT, 'Viewer Notes versions are append-only');
END;

DROP TRIGGER IF EXISTS ai_note_versions_append_only_delete;
CREATE TRIGGER ai_note_versions_append_only_delete
BEFORE DELETE ON ai_note_versions
WHEN NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'Viewer Notes versions are append-only');
END;

DROP TRIGGER IF EXISTS ai_note_activation_append_only_delete;
CREATE TRIGGER ai_note_activation_append_only_delete
BEFORE DELETE ON ai_note_activation_events
WHEN NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'Viewer Notes activation history is append-only');
END;
