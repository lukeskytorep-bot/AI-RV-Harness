-- DIRECT-3B1: identity/storage only. New native connections are disabled pending later transport stages.

-- Back up every affected row before rebuilding with foreign keys enabled. Defer only within the migration transaction.

PRAGMA defer_foreign_keys=ON;

CREATE TEMP TABLE backup_035_provider_configs AS SELECT * FROM provider_configs;

CREATE TEMP TABLE backup_035_model_registry AS SELECT * FROM model_registry;

CREATE TEMP TABLE backup_035_ai_identities AS SELECT * FROM ai_identities;

CREATE TEMP TABLE backup_035_ai_note_reflection_runs AS SELECT * FROM ai_note_reflection_runs;

CREATE TEMP TABLE backup_035_ai_note_versions AS SELECT * FROM ai_note_versions;

CREATE TEMP TABLE backup_035_ai_note_settings AS SELECT * FROM ai_note_settings;

CREATE TEMP TABLE backup_035_ai_note_activation_events AS SELECT * FROM ai_note_activation_events;

CREATE TEMP TABLE backup_035_field_guide_versions AS SELECT * FROM field_guide_versions;

CREATE TEMP TABLE backup_035_field_guide_settings AS SELECT * FROM field_guide_settings;

CREATE TEMP TABLE backup_035_field_guide_activation_events AS SELECT * FROM field_guide_activation_events;

CREATE TEMP TABLE backup_035_field_guide_legacy_baselines AS SELECT * FROM field_guide_legacy_baselines;

DROP TRIGGER ai_note_settings_active_identity_guard;

DROP TRIGGER ai_note_settings_active_identity_guard_insert;

DROP TRIGGER ai_note_versions_stale_base_guard;

DROP TRIGGER ai_note_activation_append_only_update;

DROP TRIGGER ai_note_activation_identity_guard;

DROP TRIGGER ai_note_versions_append_only_update;

DROP TRIGGER ai_note_versions_append_only_delete;

DROP TRIGGER ai_note_activation_append_only_delete;

DROP TRIGGER field_guide_settings_viewer_identity_guard;

DROP TRIGGER field_guide_versions_viewer_identity_guard;

DROP TRIGGER field_guide_settings_active_identity_insert_guard;

DROP TRIGGER field_guide_settings_active_identity_guard;

DROP TRIGGER field_guide_versions_lineage_identity_guard;

DROP TRIGGER field_guide_activation_identity_guard;

DROP TRIGGER field_guide_versions_append_only_update;

DROP TRIGGER field_guide_activation_events_append_only;

DROP TRIGGER field_guide_versions_append_only_delete;

DROP TRIGGER field_guide_activation_events_append_only_delete;

DROP TRIGGER field_guide_legacy_baselines_delete_guard;

DROP TRIGGER field_guide_legacy_baseline_resolution_guard;

DROP TABLE model_registry;

DROP TABLE provider_configs;

DROP TABLE field_guide_legacy_baselines;

DROP TABLE field_guide_activation_events;

DROP TABLE field_guide_settings;

DROP TABLE field_guide_versions;

DROP TABLE ai_note_activation_events;

DROP TABLE ai_note_settings;

DROP TABLE ai_note_versions;

DROP TABLE ai_note_reflection_runs;

DROP TABLE ai_identities;

CREATE TABLE "provider_configs" (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('openrouter','google','openai','anthropic','zai','deepseek','mistral','blackbox','custom_openai','ollama_native')),
  label TEXT NOT NULL,
  credential_id TEXT REFERENCES credentials_metadata(id) ON DELETE CASCADE,
  credential_hint TEXT,
  base_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  last_tested_at TEXT,
  last_status TEXT CHECK(last_status IS NULL OR last_status IN ('ok','error')),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
,
  auth_mode TEXT NOT NULL DEFAULT 'legacy_credential' CHECK(auth_mode IN ('legacy_credential','none','bearer')),
  connection_identity_id TEXT UNIQUE,
  connection_revision INTEGER,
  CHECK((provider <> 'ollama_native' AND credential_id IS NOT NULL AND auth_mode='legacy_credential' AND connection_identity_id IS NULL AND connection_revision IS NULL)
    OR (provider='ollama_native' AND connection_identity_id IS NOT NULL AND length(trim(connection_identity_id))>0 AND connection_revision IS NOT NULL AND typeof(connection_revision)='integer' AND connection_revision>=1 AND connection_revision<=9007199254740991
      AND ((auth_mode='none' AND credential_id IS NULL AND credential_hint IS NULL) OR (auth_mode='bearer' AND credential_id IS NOT NULL)))),
  CHECK(provider <> 'ollama_native' OR enabled=0)
);

CREATE TABLE "model_registry" (
  provider_config_id TEXT NOT NULL REFERENCES "provider_configs"(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  route TEXT NOT NULL,
  capability_json TEXT NOT NULL,
  pricing_json TEXT NOT NULL DEFAULT '{}',
  recommended INTEGER NOT NULL DEFAULT 0 CHECK(recommended IN (0,1)),
  raw_metadata_json TEXT NOT NULL DEFAULT '{}',
  refreshed_at TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
  PRIMARY KEY(provider_config_id, model_id)
);

CREATE TABLE ai_identities (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  credential_fingerprint TEXT,
  credential_display TEXT,
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
  updated_at TEXT NOT NULL
,
  identity_kind TEXT NOT NULL DEFAULT 'credential' CHECK(identity_kind IN ('credential','connection')),
  connection_identity_id TEXT,
  connection_revision INTEGER,
  CHECK((identity_kind='credential' AND provider <> 'ollama_native' AND credential_fingerprint IS NOT NULL AND credential_display IS NOT NULL AND connection_identity_id IS NULL AND connection_revision IS NULL)
    OR (identity_kind='connection' AND provider='ollama_native' AND credential_fingerprint IS NULL AND credential_display IS NULL AND connection_identity_id IS NOT NULL AND length(trim(connection_identity_id))>0 AND connection_revision IS NOT NULL AND typeof(connection_revision)='integer' AND connection_revision>=1 AND connection_revision<=9007199254740991))
,
  UNIQUE(profile_id, credential_fingerprint, provider, normalized_base_url, model_route, role)
);

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

CREATE TABLE ai_note_settings (
  ai_identity_id TEXT PRIMARY KEY NOT NULL REFERENCES ai_identities(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL DEFAULT 'viewer_self_notes' CHECK(note_type = 'viewer_self_notes'),
  capacity_tokens INTEGER NOT NULL DEFAULT 1024 CHECK(capacity_tokens IN (1024,2048,4096,8192)),
  default_enabled INTEGER NOT NULL DEFAULT 1 CHECK(default_enabled IN (0,1)),
  active_version_id TEXT,
  experimental_status TEXT NOT NULL DEFAULT 'experimental' CHECK(experimental_status = 'experimental'),
  updated_at TEXT NOT NULL
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

CREATE TABLE field_guide_settings (
  ai_identity_id TEXT NOT NULL REFERENCES ai_identities(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK(language IN ('pl','en')),
  capacity_tokens INTEGER NOT NULL DEFAULT 2048 CHECK(capacity_tokens IN (2048,4096,8192)),
  active_version_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(ai_identity_id, language)
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

INSERT INTO provider_configs (id,provider,label,credential_id,credential_hint,base_url,enabled,last_tested_at,last_status,last_error,created_at,updated_at) SELECT id,provider,label,credential_id,credential_hint,base_url,enabled,last_tested_at,last_status,last_error,created_at,updated_at FROM backup_035_provider_configs;

INSERT INTO model_registry (provider_config_id,provider,model_id,display_name,route,capability_json,pricing_json,recommended,raw_metadata_json,refreshed_at,favorite) SELECT provider_config_id,provider,model_id,display_name,route,capability_json,pricing_json,recommended,raw_metadata_json,refreshed_at,favorite FROM backup_035_model_registry;

INSERT INTO ai_identities (id,profile_id,credential_fingerprint,credential_display,provider_config_id,provider,normalized_base_url,model_id,model_route,model_display_name,role,route_status,first_used_at,last_used_at,created_at,updated_at) SELECT id,profile_id,credential_fingerprint,credential_display,provider_config_id,provider,normalized_base_url,model_id,model_route,model_display_name,role,route_status,first_used_at,last_used_at,created_at,updated_at FROM backup_035_ai_identities;

INSERT INTO ai_note_reflection_runs (id,ai_identity_id,note_type,source_session_id,source_workspace_id,source_snapshot_json,base_version_id,base_content_sha256,reflection_packet_sha256,packet_json,attempt_count,status,provider_request_id,raw_final_response_sha256,change_summary,failure_message,created_at,completed_at) SELECT id,ai_identity_id,note_type,source_session_id,source_workspace_id,source_snapshot_json,base_version_id,base_content_sha256,reflection_packet_sha256,packet_json,attempt_count,status,provider_request_id,raw_final_response_sha256,change_summary,failure_message,created_at,completed_at FROM backup_035_ai_note_reflection_runs;

INSERT INTO ai_note_versions (id,ai_identity_id,version_number,content,content_sha256,estimated_tokens,estimator_version,capacity_tokens_at_creation,source_session_id,source_workspace_id,source_snapshot_json,protocol_id,session_run_type,change_summary,base_version_id,base_content_sha256,reflection_run_id,reflection_packet_sha256,model_route_snapshot,generation_settings_json,upstream_provider_snapshot,created_at) SELECT id,ai_identity_id,version_number,content,content_sha256,estimated_tokens,estimator_version,capacity_tokens_at_creation,source_session_id,source_workspace_id,source_snapshot_json,protocol_id,session_run_type,change_summary,base_version_id,base_content_sha256,reflection_run_id,reflection_packet_sha256,model_route_snapshot,generation_settings_json,upstream_provider_snapshot,created_at FROM backup_035_ai_note_versions;

INSERT INTO ai_note_settings (ai_identity_id,note_type,capacity_tokens,default_enabled,active_version_id,experimental_status,updated_at) SELECT ai_identity_id,note_type,capacity_tokens,default_enabled,active_version_id,experimental_status,updated_at FROM backup_035_ai_note_settings;

INSERT INTO ai_note_activation_events (id,ai_identity_id,from_version_id,to_version_id,activation_source,workspace_id,source_session_id,created_at) SELECT id,ai_identity_id,from_version_id,to_version_id,activation_source,workspace_id,source_session_id,created_at FROM backup_035_ai_note_activation_events;

INSERT INTO field_guide_versions (id,ai_identity_id,language,version_number,content,content_sha256,estimated_tokens,estimator_version,capacity_tokens_at_creation,source_training_run_id,source_session_id,source_snapshot_json,lexicon_id,lexicon_version,previous_version_id,restored_from_version_id,created_at) SELECT id,ai_identity_id,language,version_number,content,content_sha256,estimated_tokens,estimator_version,capacity_tokens_at_creation,source_training_run_id,source_session_id,source_snapshot_json,lexicon_id,lexicon_version,previous_version_id,restored_from_version_id,created_at FROM backup_035_field_guide_versions;

INSERT INTO field_guide_settings (ai_identity_id,language,capacity_tokens,active_version_id,updated_at) SELECT ai_identity_id,language,capacity_tokens,active_version_id,updated_at FROM backup_035_field_guide_settings;

INSERT INTO field_guide_activation_events (id,ai_identity_id,language,from_version_id,to_version_id,activation_source,created_at) SELECT id,ai_identity_id,language,from_version_id,to_version_id,activation_source,created_at FROM backup_035_field_guide_activation_events;

INSERT INTO field_guide_legacy_baselines (id,profile_id,original_content,source_profile_updated_at,resolution_status,resolved_ai_identity_id,resolved_language,resolved_version_id,created_at,resolved_at) SELECT id,profile_id,original_content,source_profile_updated_at,resolution_status,resolved_ai_identity_id,resolved_language,resolved_version_id,created_at,resolved_at FROM backup_035_field_guide_legacy_baselines;

CREATE INDEX idx_provider_configs_provider ON provider_configs(provider, updated_at DESC);

CREATE INDEX idx_model_registry_provider ON model_registry(provider, display_name);

CREATE INDEX idx_model_registry_recommended ON model_registry(recommended, display_name);

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

CREATE TRIGGER ai_note_versions_stale_base_guard
BEFORE INSERT ON ai_note_versions
WHEN COALESCE((SELECT active_version_id FROM ai_note_settings WHERE ai_identity_id = NEW.ai_identity_id), '') <> COALESCE(NEW.base_version_id, '')
 OR COALESCE((SELECT content_sha256 FROM ai_note_versions WHERE id = (SELECT active_version_id FROM ai_note_settings WHERE ai_identity_id = NEW.ai_identity_id)), '') <> COALESCE(NEW.base_content_sha256, '')
BEGIN
  SELECT RAISE(ABORT, 'STALE_BASE');
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

CREATE TRIGGER ai_note_activation_identity_guard
BEFORE INSERT ON ai_note_activation_events
WHEN NOT EXISTS (SELECT 1 FROM ai_note_versions v WHERE v.id = NEW.to_version_id AND v.ai_identity_id = NEW.ai_identity_id)
 OR (NEW.from_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ai_note_versions v WHERE v.id = NEW.from_version_id AND v.ai_identity_id = NEW.ai_identity_id))
BEGIN
  SELECT RAISE(ABORT, 'Viewer Notes activation version belongs to another AI identity');
END;

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

CREATE TRIGGER ai_note_versions_append_only_delete
BEFORE DELETE ON ai_note_versions
WHEN NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'Viewer Notes versions are append-only');
END;

CREATE TRIGGER ai_note_activation_append_only_delete
BEFORE DELETE ON ai_note_activation_events
WHEN NOT EXISTS (SELECT 1 FROM controlled_purge_context WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'Viewer Notes activation history is append-only');
END;

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

CREATE UNIQUE INDEX ai_connection_identity_route ON ai_identities(profile_id,connection_identity_id,connection_revision,normalized_base_url,model_route,role) WHERE identity_kind='connection';

CREATE TABLE profile_native_connection_routes (
  profile_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider_config_id TEXT NOT NULL REFERENCES provider_configs(id) ON DELETE RESTRICT,
  connection_identity_id TEXT NOT NULL,
  connection_revision INTEGER NOT NULL CHECK(typeof(connection_revision)='integer' AND connection_revision>=1 AND connection_revision<=9007199254740991),
  normalized_endpoint TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER native_profile_route_guard BEFORE INSERT ON profile_native_connection_routes
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM profiles p JOIN provider_configs c ON c.id=NEW.provider_config_id
  WHERE p.id=NEW.profile_id AND p.credential_id IS NULL AND p.archived_at IS NULL
  AND c.provider='ollama_native' AND c.auth_mode='none' AND c.credential_id IS NULL AND c.enabled=0
  AND c.connection_identity_id=NEW.connection_identity_id AND c.connection_revision=NEW.connection_revision AND c.base_url=NEW.normalized_endpoint)
 THEN RAISE(ABORT,'native profile connection binding mismatch') END;
END;

CREATE TRIGGER native_profile_route_immutable BEFORE UPDATE ON profile_native_connection_routes BEGIN SELECT RAISE(ABORT,'native profile route must be explicitly replaced'); END;

CREATE TRIGGER native_connection_identity_guard BEFORE INSERT ON ai_identities WHEN NEW.identity_kind='connection'
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM profile_native_connection_routes r JOIN provider_configs c ON c.id=r.provider_config_id
  WHERE r.profile_id=NEW.profile_id AND r.provider_config_id=NEW.provider_config_id AND r.connection_identity_id=NEW.connection_identity_id AND r.connection_revision=NEW.connection_revision
  AND r.normalized_endpoint=NEW.normalized_base_url AND c.connection_identity_id=NEW.connection_identity_id AND c.connection_revision=NEW.connection_revision
  AND c.base_url=NEW.normalized_base_url AND c.auth_mode='none' AND c.credential_id IS NULL AND c.enabled=0)
 THEN RAISE(ABORT,'native AI connection identity mismatch') END;
END;

CREATE TRIGGER native_ai_identity_binding_immutable BEFORE UPDATE OF identity_kind,connection_identity_id,connection_revision,credential_fingerprint,credential_display,provider,provider_config_id,normalized_base_url,model_route,profile_id ON ai_identities
WHEN OLD.identity_kind='connection' OR NEW.identity_kind='connection'
BEGIN SELECT RAISE(ABORT,'native AI identity binding is immutable'); END;

DROP TABLE backup_035_provider_configs;

DROP TABLE backup_035_model_registry;

DROP TABLE backup_035_ai_identities;

DROP TABLE backup_035_ai_note_reflection_runs;

DROP TABLE backup_035_ai_note_versions;

DROP TABLE backup_035_ai_note_settings;

DROP TABLE backup_035_ai_note_activation_events;

DROP TABLE backup_035_field_guide_versions;

DROP TABLE backup_035_field_guide_settings;

DROP TABLE backup_035_field_guide_activation_events;

DROP TABLE backup_035_field_guide_legacy_baselines;

-- Make FK violations abort even if a driver ignores the rows returned by PRAGMA.

CREATE TEMP TABLE guard_035_fk(violations INTEGER CHECK(violations=0));

INSERT INTO guard_035_fk SELECT COUNT(*) FROM pragma_foreign_key_check;

DROP TABLE guard_035_fk;
