ALTER TABLE workspaces
ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy_combined'
CHECK (kind IN ('conversation', 'rv', 'legacy_combined'));

CREATE INDEX IF NOT EXISTS idx_workspaces_profile_kind_active
ON workspaces(profile_id, kind, archived_at);
