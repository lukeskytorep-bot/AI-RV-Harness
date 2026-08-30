CREATE TABLE ai_identities (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  credential_fingerprint TEXT NOT NULL,
  credential_display TEXT NOT NULL,
  provider_config_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  normalized_base_url TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL,
  model_route TEXT NOT NULL,
  model_display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('viewer','monitor','judge')),
  route_status TEXT NOT NULL DEFAULT 'available' CHECK(route_status IN ('available','unavailable')),
  first_used_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(profile_id, credential_fingerprint, provider, normalized_base_url, model_route, role)
);

CREATE TABLE ai_note_settings (
  ai_identity_id TEXT PRIMARY KEY NOT NULL REFERENCES ai_identities(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL DEFAULT 'viewer_self_notes' CHECK(note_type = 'viewer_self_notes'),
  capacity_tokens INTEGER NOT NULL DEFAULT 1024 CHECK(capacity_tokens IN (1024,2048,4096,8192)),
  default_enabled INTEGER NOT NULL DEFAULT 1 CHECK(default_enabled IN (0,1)),
  active_version_id TEXT,
  experimental_status TEXT NOT NULL DEFAULT 'experimental' CHECK(experimental_status = 'experimental'),
  updated_at TEXT NOT NULL
);

CREATE TABLE ai_note_reflection_runs (
  id TEXT PRIMARY KEY NOT NULL,
  ai_identity_id TEXT NOT NULL REFERENCES ai_identities(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL DEFAULT 'viewer_self_notes' CHECK(note_type = 'viewer_self_notes'),
  source_session_id TEXT NOT NULL REFERENCES rv_sessions(id) ON DELETE RESTRICT,
  source_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
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

CREATE TABLE ai_note_versions (
  id TEXT PRIMARY KEY NOT NULL,
  ai_identity_id TEXT NOT NULL REFERENCES ai_identities(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  estimated_tokens INTEGER NOT NULL CHECK(estimated_tokens >= 0),
  estimator_version TEXT NOT NULL CHECK(estimator_version = 'conservative-char-v1'),
  capacity_tokens_at_creation INTEGER NOT NULL CHECK(capacity_tokens_at_creation IN (1024,2048,4096,8192)),
  source_session_id TEXT NOT NULL REFERENCES rv_sessions(id) ON DELETE RESTRICT,
  source_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
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

CREATE INDEX idx_ai_identities_profile_role ON ai_identities(profile_id, role, last_used_at DESC);
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

CREATE TRIGGER ai_note_versions_append_only_update
BEFORE UPDATE ON ai_note_versions
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
