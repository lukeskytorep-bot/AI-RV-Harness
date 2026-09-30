PRAGMA foreign_keys = ON;

CREATE TABLE field_guide_settings (
  ai_identity_id TEXT NOT NULL REFERENCES ai_identities(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK(language IN ('pl','en')),
  capacity_tokens INTEGER NOT NULL DEFAULT 2048 CHECK(capacity_tokens IN (2048,4096,8192)),
  active_version_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(ai_identity_id, language)
);

CREATE TABLE field_guide_versions (
  id TEXT PRIMARY KEY NOT NULL,
  ai_identity_id TEXT NOT NULL REFERENCES ai_identities(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK(language IN ('pl','en')),
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  estimated_tokens INTEGER NOT NULL CHECK(estimated_tokens >= 0),
  estimator_version TEXT NOT NULL CHECK(estimator_version = 'conservative-char-v1'),
  capacity_tokens_at_creation INTEGER NOT NULL CHECK(capacity_tokens_at_creation IN (2048,4096,8192)),
  source_training_run_id TEXT REFERENCES training_runs(id) ON DELETE SET NULL,
  source_session_id TEXT REFERENCES rv_sessions(id) ON DELETE SET NULL,
  source_snapshot_json TEXT NOT NULL,
  lexicon_id TEXT,
  lexicon_version TEXT,
  previous_version_id TEXT REFERENCES field_guide_versions(id) ON DELETE CASCADE,
  restored_from_version_id TEXT REFERENCES field_guide_versions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(ai_identity_id, language, version_number)
);

CREATE TABLE field_guide_activation_events (
  id TEXT PRIMARY KEY NOT NULL,
  ai_identity_id TEXT NOT NULL REFERENCES ai_identities(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK(language IN ('pl','en')),
  from_version_id TEXT REFERENCES field_guide_versions(id) ON DELETE CASCADE,
  to_version_id TEXT NOT NULL REFERENCES field_guide_versions(id) ON DELETE CASCADE,
  activation_source TEXT NOT NULL CHECK(activation_source IN ('initial_version','legacy_profile_baseline','human_restore','training_reflection')),
  created_at TEXT NOT NULL
);

CREATE TABLE field_guide_legacy_baselines (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  original_content TEXT NOT NULL,
  source_profile_updated_at TEXT NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'unresolved' CHECK(resolution_status IN ('unresolved','resolved','factory-equivalent')),
  resolved_ai_identity_id TEXT REFERENCES ai_identities(id) ON DELETE SET NULL,
  resolved_language TEXT CHECK(resolved_language IS NULL OR resolved_language IN ('pl','en')),
  resolved_version_id TEXT REFERENCES field_guide_versions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE(profile_id)
);

INSERT INTO field_guide_legacy_baselines (
  id, profile_id, original_content, source_profile_updated_at, resolution_status, created_at
)
SELECT
  'field_guide_legacy_' || id,
  id,
  default_viewer_system_prompt,
  updated_at,
  'unresolved',
  updated_at
FROM profiles
WHERE default_viewer_system_prompt IS NOT NULL AND trim(default_viewer_system_prompt) <> '';

CREATE INDEX idx_field_guide_versions_identity_language ON field_guide_versions(ai_identity_id, language, version_number DESC);
CREATE INDEX idx_field_guide_activation_identity_language ON field_guide_activation_events(ai_identity_id, language, created_at DESC);
CREATE INDEX idx_field_guide_legacy_profile ON field_guide_legacy_baselines(profile_id, resolution_status);

CREATE TRIGGER field_guide_settings_viewer_identity_guard
BEFORE INSERT ON field_guide_settings
WHEN NOT EXISTS (
  SELECT 1 FROM ai_identities i
  WHERE i.id = NEW.ai_identity_id AND i.role = 'viewer'
)
BEGIN
  SELECT RAISE(ABORT, 'Field Guide settings require a Viewer identity');
END;

CREATE TRIGGER field_guide_versions_viewer_identity_guard
BEFORE INSERT ON field_guide_versions
WHEN NOT EXISTS (
  SELECT 1 FROM ai_identities i
  WHERE i.id = NEW.ai_identity_id AND i.role = 'viewer'
)
BEGIN
  SELECT RAISE(ABORT, 'Field Guide versions require a Viewer identity');
END;

CREATE TRIGGER field_guide_settings_active_identity_insert_guard
BEFORE INSERT ON field_guide_settings
WHEN NEW.active_version_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM field_guide_versions v
   WHERE v.id = NEW.active_version_id
     AND v.ai_identity_id = NEW.ai_identity_id
     AND v.language = NEW.language
 )
BEGIN
  SELECT RAISE(ABORT, 'active Field Guide version belongs to another AI identity or language');
END;

CREATE TRIGGER field_guide_settings_active_identity_guard
BEFORE UPDATE OF active_version_id ON field_guide_settings
WHEN NEW.active_version_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM field_guide_versions v
   WHERE v.id = NEW.active_version_id
     AND v.ai_identity_id = NEW.ai_identity_id
     AND v.language = NEW.language
 )
BEGIN
  SELECT RAISE(ABORT, 'active Field Guide version belongs to another AI identity or language');
END;

CREATE TRIGGER field_guide_versions_lineage_identity_guard
BEFORE INSERT ON field_guide_versions
WHEN (
  NEW.previous_version_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM field_guide_versions v
    WHERE v.id = NEW.previous_version_id
      AND v.ai_identity_id = NEW.ai_identity_id
      AND v.language = NEW.language
  )
) OR (
  NEW.restored_from_version_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM field_guide_versions v
    WHERE v.id = NEW.restored_from_version_id
      AND v.ai_identity_id = NEW.ai_identity_id
      AND v.language = NEW.language
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Field Guide version lineage crosses AI identity or language');
END;

CREATE TRIGGER field_guide_activation_identity_guard
BEFORE INSERT ON field_guide_activation_events
WHEN NOT EXISTS (
  SELECT 1 FROM field_guide_versions v
  WHERE v.id = NEW.to_version_id
    AND v.ai_identity_id = NEW.ai_identity_id
    AND v.language = NEW.language
) OR (
  NEW.from_version_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM field_guide_versions v
    WHERE v.id = NEW.from_version_id
      AND v.ai_identity_id = NEW.ai_identity_id
      AND v.language = NEW.language
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Field Guide activation crosses AI identity or language');
END;

CREATE TRIGGER field_guide_versions_append_only_update
BEFORE UPDATE ON field_guide_versions
WHEN NOT (
  NEW.id IS OLD.id
  AND NEW.ai_identity_id IS OLD.ai_identity_id
  AND NEW.language IS OLD.language
  AND NEW.version_number IS OLD.version_number
  AND NEW.content IS OLD.content
  AND NEW.content_sha256 IS OLD.content_sha256
  AND NEW.estimated_tokens IS OLD.estimated_tokens
  AND NEW.estimator_version IS OLD.estimator_version
  AND NEW.capacity_tokens_at_creation IS OLD.capacity_tokens_at_creation
  AND (NEW.source_training_run_id IS OLD.source_training_run_id OR (OLD.source_training_run_id IS NOT NULL AND NEW.source_training_run_id IS NULL))
  AND (NEW.source_session_id IS OLD.source_session_id OR (OLD.source_session_id IS NOT NULL AND NEW.source_session_id IS NULL))
  AND NEW.source_snapshot_json IS OLD.source_snapshot_json
  AND NEW.lexicon_id IS OLD.lexicon_id
  AND NEW.lexicon_version IS OLD.lexicon_version
  AND NEW.previous_version_id IS OLD.previous_version_id
  AND NEW.restored_from_version_id IS OLD.restored_from_version_id
  AND NEW.created_at IS OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'Field Guide versions are append-only');
END;

CREATE TRIGGER field_guide_activation_events_append_only
BEFORE UPDATE ON field_guide_activation_events
BEGIN
  SELECT RAISE(ABORT, 'Field Guide activation history is append-only');
END;

CREATE TRIGGER field_guide_versions_append_only_delete
BEFORE DELETE ON field_guide_versions
WHEN NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'Field Guide versions are append-only');
END;

CREATE TRIGGER field_guide_activation_events_append_only_delete
BEFORE DELETE ON field_guide_activation_events
WHEN NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'Field Guide activation history is append-only');
END;

CREATE TRIGGER field_guide_legacy_baselines_delete_guard
BEFORE DELETE ON field_guide_legacy_baselines
WHEN NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'legacy Field Guide baselines are preserved');
END;

CREATE TRIGGER field_guide_legacy_baseline_resolution_guard
BEFORE UPDATE ON field_guide_legacy_baselines
WHEN NOT (
  OLD.resolution_status = 'unresolved'
  AND NEW.id IS OLD.id
  AND NEW.profile_id IS OLD.profile_id
  AND NEW.original_content IS OLD.original_content
  AND NEW.source_profile_updated_at IS OLD.source_profile_updated_at
  AND NEW.created_at IS OLD.created_at
  AND NEW.resolution_status = 'resolved'
  AND NEW.resolved_ai_identity_id IS NOT NULL
  AND NEW.resolved_language IS NOT NULL
  AND NEW.resolved_version_id IS NOT NULL
  AND NEW.resolved_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM ai_identities i
    WHERE i.id = NEW.resolved_ai_identity_id
      AND i.profile_id = NEW.profile_id
      AND i.role = 'viewer'
  )
  AND EXISTS (
    SELECT 1 FROM field_guide_versions v
    WHERE v.id = NEW.resolved_version_id
      AND v.ai_identity_id = NEW.resolved_ai_identity_id
      AND v.language = NEW.resolved_language
  )
)
BEGIN
  SELECT RAISE(ABORT, 'legacy Field Guide baseline may only be resolved once');
END;
