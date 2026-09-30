PRAGMA foreign_keys = ON;

-- Stage 2 split the historical factory_training_01_* pack into dedicated Mountains
-- and Structures categories. Existing databases can already have these targets in
-- immutable session/Research history, so the normal target UPDATE guards correctly
-- reject the runtime seed's metadata-only synchronization. Perform that one known
-- upgrade here, before startup seeding, then restore the guards unchanged.
DROP TRIGGER IF EXISTS prevent_training_target_update;
DROP TRIGGER IF EXISTS prevent_used_target_update;

UPDATE targets
SET source_metadata_json = json_set(
  source_metadata_json,
  '$.category', 'mountains',
  '$.categoryOrder', 1,
  '$.subtype', 'mountain'
)
WHERE id = 'factory_training_01_01'
  AND collection = 'training'
  AND (
    json_extract(source_metadata_json, '$.category') IS NOT 'mountains'
    OR json_extract(source_metadata_json, '$.categoryOrder') IS NOT 1
    OR json_extract(source_metadata_json, '$.subtype') IS NOT 'mountain'
  );

UPDATE targets
SET source_metadata_json = json_set(
  source_metadata_json,
  '$.category', 'mountains',
  '$.categoryOrder', 2,
  '$.subtype', 'mountain'
)
WHERE id = 'factory_training_01_02'
  AND collection = 'training'
  AND (
    json_extract(source_metadata_json, '$.category') IS NOT 'mountains'
    OR json_extract(source_metadata_json, '$.categoryOrder') IS NOT 2
    OR json_extract(source_metadata_json, '$.subtype') IS NOT 'mountain'
  );

UPDATE targets
SET source_metadata_json = json_set(
  source_metadata_json,
  '$.category', 'mountains',
  '$.categoryOrder', 3,
  '$.subtype', 'mountain'
)
WHERE id = 'factory_training_01_03'
  AND collection = 'training'
  AND (
    json_extract(source_metadata_json, '$.category') IS NOT 'mountains'
    OR json_extract(source_metadata_json, '$.categoryOrder') IS NOT 3
    OR json_extract(source_metadata_json, '$.subtype') IS NOT 'mountain'
  );

UPDATE targets
SET source_metadata_json = json_set(
  source_metadata_json,
  '$.category', 'structures',
  '$.categoryOrder', 1,
  '$.subtype', 'structure'
)
WHERE id = 'factory_training_01_04'
  AND collection = 'training'
  AND (
    json_extract(source_metadata_json, '$.category') IS NOT 'structures'
    OR json_extract(source_metadata_json, '$.categoryOrder') IS NOT 1
    OR json_extract(source_metadata_json, '$.subtype') IS NOT 'structure'
  );

UPDATE targets
SET source_metadata_json = json_set(
  source_metadata_json,
  '$.category', 'mountains',
  '$.categoryOrder', 4,
  '$.subtype', 'mountain'
)
WHERE id = 'factory_training_01_05'
  AND collection = 'training'
  AND (
    json_extract(source_metadata_json, '$.category') IS NOT 'mountains'
    OR json_extract(source_metadata_json, '$.categoryOrder') IS NOT 4
    OR json_extract(source_metadata_json, '$.subtype') IS NOT 'mountain'
  );

UPDATE targets
SET source_metadata_json = json_set(
  source_metadata_json,
  '$.category', 'structures',
  '$.categoryOrder', 2,
  '$.subtype', 'structure'
)
WHERE id = 'factory_training_01_06'
  AND collection = 'training'
  AND (
    json_extract(source_metadata_json, '$.category') IS NOT 'structures'
    OR json_extract(source_metadata_json, '$.categoryOrder') IS NOT 2
    OR json_extract(source_metadata_json, '$.subtype') IS NOT 'structure'
  );

UPDATE targets
SET source_metadata_json = json_set(
  source_metadata_json,
  '$.category', 'mountains',
  '$.categoryOrder', 5,
  '$.subtype', 'mountain'
)
WHERE id = 'factory_training_01_07'
  AND collection = 'training'
  AND (
    json_extract(source_metadata_json, '$.category') IS NOT 'mountains'
    OR json_extract(source_metadata_json, '$.categoryOrder') IS NOT 5
    OR json_extract(source_metadata_json, '$.subtype') IS NOT 'mountain'
  );

UPDATE targets
SET source_metadata_json = json_set(
  source_metadata_json,
  '$.category', 'structures',
  '$.categoryOrder', 3,
  '$.subtype', 'structure'
)
WHERE id = 'factory_training_01_08'
  AND collection = 'training'
  AND (
    json_extract(source_metadata_json, '$.category') IS NOT 'structures'
    OR json_extract(source_metadata_json, '$.categoryOrder') IS NOT 3
    OR json_extract(source_metadata_json, '$.subtype') IS NOT 'structure'
  );

UPDATE targets
SET source_metadata_json = json_set(
  source_metadata_json,
  '$.category', 'structures',
  '$.categoryOrder', 4,
  '$.subtype', 'structure'
)
WHERE id = 'factory_training_01_09'
  AND collection = 'training'
  AND (
    json_extract(source_metadata_json, '$.category') IS NOT 'structures'
    OR json_extract(source_metadata_json, '$.categoryOrder') IS NOT 4
    OR json_extract(source_metadata_json, '$.subtype') IS NOT 'structure'
  );

UPDATE targets
SET source_metadata_json = json_set(
  source_metadata_json,
  '$.category', 'structures',
  '$.categoryOrder', 5,
  '$.subtype', 'structure'
)
WHERE id = 'factory_training_01_10'
  AND collection = 'training'
  AND (
    json_extract(source_metadata_json, '$.category') IS NOT 'structures'
    OR json_extract(source_metadata_json, '$.categoryOrder') IS NOT 5
    OR json_extract(source_metadata_json, '$.subtype') IS NOT 'structure'
  );

CREATE TRIGGER IF NOT EXISTS prevent_training_target_update
BEFORE UPDATE OF collection, title, reveal_text, reveal_artifact_path, reveal_artifact_manifest_json, tags_json, source_metadata_json, content_hash ON targets
WHEN OLD.collection = 'training'
BEGIN
  SELECT RAISE(ABORT, 'training targets are read-only');
END;

CREATE TRIGGER IF NOT EXISTS prevent_used_target_update
BEFORE UPDATE OF collection, title, reveal_text, reveal_artifact_path, reveal_artifact_manifest_json, tags_json, source_metadata_json, content_hash ON targets
WHEN EXISTS (SELECT 1 FROM target_usage WHERE target_id = OLD.id)
  OR EXISTS (SELECT 1 FROM rv_sessions WHERE target_id = OLD.id)
  OR EXISTS (SELECT 1 FROM research_assignments WHERE target_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'used targets are locked to preserve session and Research integrity');
END;
