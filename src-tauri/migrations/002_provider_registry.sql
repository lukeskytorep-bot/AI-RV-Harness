PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('openrouter','google','openai','anthropic','zai','deepseek','mistral','custom_openai')),
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

CREATE INDEX IF NOT EXISTS idx_provider_configs_provider ON provider_configs(provider, updated_at DESC);

CREATE TABLE IF NOT EXISTS model_registry (
  provider_config_id TEXT NOT NULL REFERENCES provider_configs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  route TEXT NOT NULL,
  capability_json TEXT NOT NULL,
  pricing_json TEXT NOT NULL DEFAULT '{}',
  recommended INTEGER NOT NULL DEFAULT 0 CHECK(recommended IN (0,1)),
  raw_metadata_json TEXT NOT NULL DEFAULT '{}',
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY(provider_config_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_model_registry_provider ON model_registry(provider, display_name);
CREATE INDEX IF NOT EXISTS idx_model_registry_recommended ON model_registry(recommended, display_name);
