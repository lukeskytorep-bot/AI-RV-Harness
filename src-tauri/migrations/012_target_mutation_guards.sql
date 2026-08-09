PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS prevent_training_target_update
BEFORE UPDATE OF collection, title, reveal_text, reveal_artifact_path, reveal_artifact_manifest_json, tags_json, source_metadata_json, content_hash ON targets
WHEN OLD.collection = 'training'
BEGIN
  SELECT RAISE(ABORT, 'training targets are read-only');
END;

CREATE TRIGGER IF NOT EXISTS prevent_used_target_update
BEFORE UPDATE OF collection, title, reveal_text, reveal_artifact_path, reveal_artifact_manifest_json, tags_json, source_metadata_json, content_hash ON targets
WHEN EXISTS (SELECT 1 FROM target_usage WHERE target_id = OLD.id)
  OR EXISTS (SELECT 1 FROM rv_sessions WHERE target_id = OLD.id)
  OR EXISTS (SELECT 1 FROM research_assignments WHERE target_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'used targets are locked to preserve session and Research integrity');
END;

CREATE TRIGGER IF NOT EXISTS prevent_training_target_delete
BEFORE DELETE ON targets
WHEN OLD.collection = 'training'
BEGIN
  SELECT RAISE(ABORT, 'training targets are read-only');
END;

CREATE TRIGGER IF NOT EXISTS prevent_used_target_delete
BEFORE DELETE ON targets
WHEN EXISTS (SELECT 1 FROM target_usage WHERE target_id = OLD.id)
  OR EXISTS (SELECT 1 FROM rv_sessions WHERE target_id = OLD.id)
  OR EXISTS (SELECT 1 FROM research_assignments WHERE target_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'used targets are locked to preserve session and Research integrity');
END;
