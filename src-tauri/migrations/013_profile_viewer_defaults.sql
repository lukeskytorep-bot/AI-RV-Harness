PRAGMA foreign_keys = ON;

ALTER TABLE profiles ADD COLUMN default_viewer_reasoning_effort TEXT
  CHECK(default_viewer_reasoning_effort IS NULL OR default_viewer_reasoning_effort IN ('none','minimal','low','medium','high','xhigh','max'));
ALTER TABLE profiles ADD COLUMN default_viewer_temperature REAL;
ALTER TABLE profiles ADD COLUMN default_viewer_system_prompt TEXT;
