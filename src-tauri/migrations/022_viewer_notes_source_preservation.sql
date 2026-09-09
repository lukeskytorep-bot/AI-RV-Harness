-- UX-DATA-7: preserve Viewer Notes history when source Session/Workspace records are later purged.
-- The historical snapshot remains immutable. Live source references become nullable and detach automatically.

DROP TRIGGER IF EXISTS ai_note_settings_active_identity_guard;
DROP TRIGGER IF EXISTS ai_note_settings_active_identity_guard_insert;
DROP TRIGGER IF EXISTS ai_note_versions_append_only_update;
DROP TRIGGER IF EXISTS ai_note_versions_stale_base_guard;
DROP TRIGGER IF EXISTS ai_note_versions_append_only_delete;
DROP TRIGGER IF EXISTS ai_note_activation_append_only_update;
DROP TRIGGER IF EXISTS ai_note_activation_append_only_delete;
DROP TRIGGER IF EXISTS ai_note_activation_identity_guard;

DROP INDEX IF EXISTS idx_ai_note_versions_identity;
DROP INDEX IF EXISTS idx_ai_note_runs_identity;
DROP INDEX IF EXISTS idx_ai_note_activation_identity;

ALTER TABLE ai_note_activation_events RENAME TO ai_note_activation_events_legacy_022;
ALTER TABLE ai_note_versions RENAME TO ai_note_versions_legacy_022;
ALTER TABLE ai_note_reflection_runs RENAME TO ai_note_reflection_runs_legacy_022;

CREATE TABLE ai_note_reflection_runs (
  id TEXT PRIMARY KEY NOT NULL,
  ai_identity_id TEXT NOT NULL REFERENCES ai_identities(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL DEFAULT 'viewer_self_notes' CHECK(note_type = 'viewer_self_notes'),
  source_session_id TEXT REFERENCES rv_sessions(id) ON DELETE SET NULL,
  source_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  source_snapshot_json TEXT NOT NULL,
  base_version_id TEXT,
  base_content_sha256 TEXT,
  reflection_packet_sha256 TEXT NOT NULL,
  packet_json TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  status TEXT NOT NULL CHECK(status IN ('PENDING','UPDATE','NO_CHANGE','FAILED_PROVIDER','FAILED_PARSE','FAILED_SCHEMA','FAILED_CAPACITY','FAILED_OUTPUT_PREFLIGHT','FAILED_MEMORY_SAFETY','STALE_BASE','BLOCKED_RESEARCH_LOCK')),
  provider_request_id TEXT,
  raw_final_response_sha256 TEXT,
  change_summary TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(ai_identity_id, note_type, source_session_id)
);

INSERT INTO ai_note_reflection_runs (
  id, ai_identity_id, note_type, source_session_id, source_workspace_id, source_snapshot_json,
  base_version_id, base_content_sha256, reflection_packet_sha256, packet_json, attempt_count, status,
  provider_request_id, raw_final_response_sha256, change_summary, failure_message, created_at, completed_at
)
SELECT
  r.id, r.ai_identity_id, r.note_type, r.source_session_id, r.source_workspace_id,
  json_patch(
    json_object(
      'schemaVersion', 1,
      'sessionId', r.source_session_id,
      'sessionCode', COALESCE(s.session_code, ''),
      'workspaceId', r.source_workspace_id,
      'workspaceName', COALESCE(w.name, ''),
      'profileId', COALESCE(s.profile_id, w.profile_id, ''),
      'protocolId', CASE WHEN json_valid(r.packet_json) THEN COALESCE(json_extract(r.packet_json, '$.protocolId'), '') ELSE '' END,
      'protocolVersion', '',
      'sessionRunType', CASE WHEN json_valid(r.packet_json) THEN COALESCE(json_extract(r.packet_json, '$.sessionRunType'), '') ELSE '' END,
      'capturedAt', r.created_at
    ),
    COALESCE((
      SELECT json_object(
        'trainingRunId', t.id,
        'trainingRunNumber', t.run_number,
        'trainingRunName', COALESCE(json_extract(t.record_json, '$.name'), '')
      )
      FROM training_runs t
      WHERE (
        json_valid(t.record_json)
        AND (
          EXISTS (
            SELECT 1 FROM json_each(COALESCE(json_extract(t.record_json, '$.sessionIds'), '[]'))
            WHERE value = r.source_session_id
          )
          OR json_extract(t.record_json, '$.activeTargetCheckpoint.sessionId') = r.source_session_id
        )
      )
      ORDER BY t.run_number DESC
      LIMIT 1
    ), '{}')
  ),
  r.base_version_id, r.base_content_sha256, r.reflection_packet_sha256, r.packet_json, r.attempt_count, r.status,
  r.provider_request_id, r.raw_final_response_sha256, r.change_summary, r.failure_message, r.created_at, r.completed_at
FROM ai_note_reflection_runs_legacy_022 r
LEFT JOIN rv_sessions s ON s.id = r.source_session_id
LEFT JOIN workspaces w ON w.id = r.source_workspace_id;

CREATE TABLE ai_note_versions (
  id TEXT PRIMARY KEY NOT NULL,
  ai_identity_id TEXT NOT NULL REFERENCES ai_identities(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  estimated_tokens INTEGER NOT NULL CHECK(estimated_tokens >= 0),
  estimator_version TEXT NOT NULL CHECK(estimator_version = 'conservative-char-v1'),
  capacity_tokens_at_creation INTEGER NOT NULL CHECK(capacity_tokens_at_creation IN (1024,2048,4096,8192)),
  source_session_id TEXT REFERENCES rv_sessions(id) ON DELETE SET NULL,
  source_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  source_snapshot_json TEXT NOT NULL,
  protocol_id TEXT NOT NULL,
  session_run_type TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  base_version_id TEXT REFERENCES ai_note_versions(id) ON DELETE RESTRICT,
  base_content_sha256 TEXT,
  reflection_run_id TEXT NOT NULL UNIQUE REFERENCES ai_note_reflection_runs(id) ON DELETE RESTRICT,
  reflection_packet_sha256 TEXT NOT NULL,
  model_route_snapshot TEXT NOT NULL,
  generation_settings_json TEXT NOT NULL,
  upstream_provider_snapshot TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(ai_identity_id, version_number)
);

INSERT INTO ai_note_versions (
  id, ai_identity_id, version_number, content, content_sha256, estimated_tokens, estimator_version, capacity_tokens_at_creation,
  source_session_id, source_workspace_id, source_snapshot_json, protocol_id, session_run_type, change_summary,
  base_version_id, base_content_sha256, reflection_run_id, reflection_packet_sha256, model_route_snapshot,
  generation_settings_json, upstream_provider_snapshot, created_at
)
SELECT
  v.id, v.ai_identity_id, v.version_number, v.content, v.content_sha256, v.estimated_tokens, v.estimator_version, v.capacity_tokens_at_creation,
  v.source_session_id, v.source_workspace_id,
  COALESCE(
    (SELECT r.source_snapshot_json FROM ai_note_reflection_runs r WHERE r.id = v.reflection_run_id),
    json_object(
      'schemaVersion', 1,
      'sessionId', v.source_session_id,
      'sessionCode', COALESCE(s.session_code, ''),
      'workspaceId', v.source_workspace_id,
      'workspaceName', COALESCE(w.name, ''),
      'profileId', COALESCE(s.profile_id, w.profile_id, ''),
      'protocolId', v.protocol_id,
      'protocolVersion', '',
      'sessionRunType', v.session_run_type,
      'capturedAt', v.created_at
    )
  ),
  v.protocol_id, v.session_run_type, v.change_summary, v.base_version_id, v.base_content_sha256, v.reflection_run_id,
  v.reflection_packet_sha256, v.model_route_snapshot, v.generation_settings_json, v.upstream_provider_snapshot, v.created_at
FROM ai_note_versions_legacy_022 v
LEFT JOIN rv_sessions s ON s.id = v.source_session_id
LEFT JOIN workspaces w ON w.id = v.source_workspace_id
ORDER BY v.ai_identity_id, v.version_number;

CREATE TABLE ai_note_activation_events (
  id TEXT PRIMARY KEY NOT NULL,
  ai_identity_id TEXT NOT NULL REFERENCES ai_identities(id) ON DELETE CASCADE,
  from_version_id TEXT REFERENCES ai_note_versions(id) ON DELETE RESTRICT,
  to_version_id TEXT NOT NULL REFERENCES ai_note_versions(id) ON DELETE RESTRICT,
  activation_source TEXT NOT NULL CHECK(activation_source IN ('model_update','model_confirmed','human_restore','initial_version')),
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  source_session_id TEXT REFERENCES rv_sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

INSERT INTO ai_note_activation_events (
  id, ai_identity_id, from_version_id, to_version_id, activation_source, workspace_id, source_session_id, created_at
)
SELECT id, ai_identity_id, from_version_id, to_version_id, activation_source, workspace_id, source_session_id, created_at
FROM ai_note_activation_events_legacy_022;

DROP TABLE ai_note_activation_events_legacy_022;
-- Break only the self-reference inside the temporary legacy copy so SQLite can drop it with foreign keys enabled.
UPDATE ai_note_versions_legacy_022 SET base_version_id = NULL;
DROP TABLE ai_note_versions_legacy_022;
DROP TABLE ai_note_reflection_runs_legacy_022;

CREATE INDEX idx_ai_note_versions_identity ON ai_note_versions(ai_identity_id, version_number DESC);
CREATE INDEX idx_ai_note_runs_identity ON ai_note_reflection_runs(ai_identity_id, created_at DESC);
CREATE INDEX idx_ai_note_activation_identity ON ai_note_activation_events(ai_identity_id, created_at DESC);

CREATE TRIGGER ai_note_settings_active_identity_guard
BEFORE UPDATE OF active_version_id ON ai_note_settings
WHEN NEW.active_version_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM ai_note_versions v WHERE v.id = NEW.active_version_id AND v.ai_identity_id = NEW.ai_identity_id)
BEGIN
  SELECT RAISE(ABORT, 'active Viewer Notes version belongs to another AI identity');
END;

CREATE TRIGGER ai_note_settings_active_identity_guard_insert
BEFORE INSERT ON ai_note_settings
WHEN NEW.active_version_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM ai_note_versions v WHERE v.id = NEW.active_version_id AND v.ai_identity_id = NEW.ai_identity_id)
BEGIN
  SELECT RAISE(ABORT, 'active Viewer Notes version belongs to another AI identity');
END;

-- Viewer Notes remain append-only. The only permitted UPDATE is automatic detachment
-- of live source references (non-null -> null) caused by a later source purge.
CREATE TRIGGER ai_note_versions_append_only_update
BEFORE UPDATE ON ai_note_versions
WHEN NOT (
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

CREATE TRIGGER ai_note_versions_stale_base_guard
BEFORE INSERT ON ai_note_versions
WHEN COALESCE((SELECT active_version_id FROM ai_note_settings WHERE ai_identity_id = NEW.ai_identity_id), '') <> COALESCE(NEW.base_version_id, '')
 OR COALESCE((SELECT content_sha256 FROM ai_note_versions WHERE id = (SELECT active_version_id FROM ai_note_settings WHERE ai_identity_id = NEW.ai_identity_id)), '') <> COALESCE(NEW.base_content_sha256, '')
BEGIN
  SELECT RAISE(ABORT, 'STALE_BASE');
END;

CREATE TRIGGER ai_note_versions_append_only_delete
BEFORE DELETE ON ai_note_versions
BEGIN
  SELECT RAISE(ABORT, 'Viewer Notes versions are append-only');
END;

CREATE TRIGGER ai_note_activation_append_only_update
BEFORE UPDATE ON ai_note_activation_events
WHEN NOT (
  NEW.id IS OLD.id
  AND NEW.ai_identity_id IS OLD.ai_identity_id
  AND NEW.from_version_id IS OLD.from_version_id
  AND NEW.to_version_id IS OLD.to_version_id
  AND NEW.activation_source IS OLD.activation_source
  AND (NEW.workspace_id IS OLD.workspace_id OR (OLD.workspace_id IS NOT NULL AND NEW.workspace_id IS NULL))
  AND (NEW.source_session_id IS OLD.source_session_id OR (OLD.source_session_id IS NOT NULL AND NEW.source_session_id IS NULL))
  AND NEW.created_at IS OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'Viewer Notes activation history is append-only');
END;

CREATE TRIGGER ai_note_activation_append_only_delete
BEFORE DELETE ON ai_note_activation_events
BEGIN
  SELECT RAISE(ABORT, 'Viewer Notes activation history is append-only');
END;

CREATE TRIGGER ai_note_activation_identity_guard
BEFORE INSERT ON ai_note_activation_events
WHEN NOT EXISTS (SELECT 1 FROM ai_note_versions v WHERE v.id = NEW.to_version_id AND v.ai_identity_id = NEW.ai_identity_id)
 OR (NEW.from_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ai_note_versions v WHERE v.id = NEW.from_version_id AND v.ai_identity_id = NEW.ai_identity_id))
BEGIN
  SELECT RAISE(ABORT, 'Viewer Notes activation version belongs to another AI identity');
END;
