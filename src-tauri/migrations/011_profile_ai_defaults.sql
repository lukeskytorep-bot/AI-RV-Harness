PRAGMA foreign_keys = ON;

ALTER TABLE profiles ADD COLUMN default_viewer_model_id TEXT;
ALTER TABLE profiles ADD COLUMN default_monitor_provider_config_id TEXT;
ALTER TABLE profiles ADD COLUMN default_monitor_model_id TEXT;
ALTER TABLE profiles ADD COLUMN default_judge_provider_config_id TEXT;
ALTER TABLE profiles ADD COLUMN default_judge_model_id TEXT;
