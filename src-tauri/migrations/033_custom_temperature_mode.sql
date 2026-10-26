PRAGMA foreign_keys = ON;

ALTER TABLE profiles ADD COLUMN default_viewer_custom_temperature_mode TEXT
  CHECK(default_viewer_custom_temperature_mode IS NULL OR default_viewer_custom_temperature_mode IN ('provider_default', 'manual'));
