PRAGMA foreign_keys = ON;

ALTER TABLE profiles ADD COLUMN default_viewer_sampling_enabled INTEGER NOT NULL DEFAULT 0
  CHECK(default_viewer_sampling_enabled IN (0, 1));
ALTER TABLE profiles ADD COLUMN default_viewer_top_p REAL
  CHECK(default_viewer_top_p IS NULL OR (default_viewer_top_p >= 0.0 AND default_viewer_top_p <= 1.0));
ALTER TABLE profiles ADD COLUMN default_viewer_top_k INTEGER
  CHECK(default_viewer_top_k IS NULL OR (typeof(default_viewer_top_k) = 'integer' AND default_viewer_top_k >= 0 AND default_viewer_top_k <= 9007199254740991));
ALTER TABLE profiles ADD COLUMN default_viewer_seed INTEGER
  CHECK(default_viewer_seed IS NULL OR (typeof(default_viewer_seed) = 'integer' AND default_viewer_seed >= 0 AND default_viewer_seed <= 9007199254740991));
