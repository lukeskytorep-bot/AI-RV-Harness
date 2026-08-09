ALTER TABLE targets
ADD COLUMN reveal_artifact_manifest_json TEXT NOT NULL DEFAULT '[]';
