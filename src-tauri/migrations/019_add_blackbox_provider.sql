CREATE TABLE provider_configs_v19 (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('openrouter','google','openai','anthropic','zai','deepseek','mistral','blackbox','custom_openai')),
  label TEXT NOT NULL,
  credential_id TEXT NOT NULL REFERENCES credentials_metadata(id) ON DELETE CASCADE,
  credential_hint TEXT,
  base_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  last_tested_at TEXT,
  last_status TEXT CHECK(last_status IS NULL OR last_status IN ('ok','error')),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO provider_configs_v19
SELECT id, provider, label, credential_id, credential_hint, base_url, enabled,
       last_tested_at, last_status, last_error, created_at, updated_at
  FROM provider_configs;

CREATE TABLE model_registry_v19 (
  provider_config_id TEXT NOT NULL REFERENCES provider_configs_v19(id) ON DELETE CASCADE,
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

INSERT INTO model_registry_v19
SELECT provider_config_id, provider, model_id, display_name, route, capability_json,
       pricing_json, recommended, raw_metadata_json, refreshed_at, favorite
  FROM model_registry;

DROP TABLE model_registry;
DROP TABLE provider_configs;
ALTER TABLE provider_configs_v19 RENAME TO provider_configs;
ALTER TABLE model_registry_v19 RENAME TO model_registry;

CREATE INDEX idx_provider_configs_provider ON provider_configs(provider, updated_at DESC);
CREATE INDEX idx_model_registry_provider ON model_registry(provider, display_name);
CREATE INDEX idx_model_registry_recommended ON model_registry(recommended, display_name);
