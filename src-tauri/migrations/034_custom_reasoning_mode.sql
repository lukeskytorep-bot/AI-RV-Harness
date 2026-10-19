PRAGMA foreign_keys = ON;

ALTER TABLE profiles ADD COLUMN default_viewer_custom_reasoning_mode TEXT
  CHECK(default_viewer_custom_reasoning_mode IS NULL OR default_viewer_custom_reasoning_mode IN ('default', 'on', 'off'));
