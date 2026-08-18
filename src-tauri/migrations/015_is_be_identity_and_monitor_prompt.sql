PRAGMA foreign_keys = ON;

ALTER TABLE profiles ADD COLUMN human_display_name TEXT;
ALTER TABLE profiles ADD COLUMN default_monitor_system_prompt TEXT;
