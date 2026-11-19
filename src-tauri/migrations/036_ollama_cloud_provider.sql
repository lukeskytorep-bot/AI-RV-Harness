-- Add the hosted credential-backed provider without activating pending local/native records.
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=ON;
CREATE TEMP TABLE backup_036_provider_configs AS SELECT * FROM provider_configs;
CREATE TEMP TABLE backup_036_model_registry AS SELECT * FROM model_registry;
CREATE TEMP TABLE backup_036_native_routes AS SELECT * FROM profile_native_connection_routes;
DROP TRIGGER native_connection_identity_guard;
DROP TABLE profile_native_connection_routes;
DROP TABLE model_registry;
DROP TABLE provider_configs;
CREATE TABLE "provider_configs" (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('openrouter','google','openai','anthropic','zai','deepseek','mistral','blackbox','custom_openai','ollama_native','ollama_cloud')),
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

CREATE TABLE profile_native_connection_routes (
  profile_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider_config_id TEXT NOT NULL REFERENCES provider_configs(id) ON DELETE RESTRICT,
  connection_identity_id TEXT NOT NULL,
  connection_revision INTEGER NOT NULL CHECK(typeof(connection_revision)='integer' AND connection_revision>=1 AND connection_revision<=9007199254740991),
  normalized_endpoint TEXT NOT NULL,
  created_at TEXT NOT NULL
);


INSERT INTO provider_configs SELECT * FROM backup_036_provider_configs;
INSERT INTO model_registry SELECT * FROM backup_036_model_registry;
INSERT INTO profile_native_connection_routes SELECT * FROM backup_036_native_routes;
CREATE INDEX idx_provider_configs_provider ON provider_configs(provider,updated_at DESC);
CREATE INDEX idx_model_registry_provider ON model_registry(provider,display_name);
CREATE INDEX idx_model_registry_recommended ON model_registry(recommended,display_name);
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


CREATE TEMP TABLE assert_036_foreign_keys(ok INTEGER CHECK(ok=1));
INSERT INTO assert_036_foreign_keys SELECT CASE WHEN EXISTS(SELECT 1 FROM pragma_foreign_key_check) THEN 0 ELSE 1 END;
DROP TABLE assert_036_foreign_keys;
DROP TABLE backup_036_provider_configs;
DROP TABLE backup_036_model_registry;
DROP TABLE backup_036_native_routes;
