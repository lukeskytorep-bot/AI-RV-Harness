PRAGMA foreign_keys = ON;

ALTER TABLE telepathic_series ADD COLUMN run_lease_owner TEXT;
ALTER TABLE telepathic_series ADD COLUMN run_lease_expires_at TEXT;
ALTER TABLE telepathic_series ADD COLUMN run_lease_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_telepathic_series_run_lease
ON telepathic_series(run_lease_expires_at);
