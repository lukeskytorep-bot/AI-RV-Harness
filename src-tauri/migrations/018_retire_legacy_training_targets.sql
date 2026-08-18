-- Keep legacy starter targets for historical foreign-key references, but remove
-- them from the active Training Target library replaced by the factory pack 84.
ALTER TABLE targets
ADD COLUMN retired_at TEXT;

UPDATE targets
SET retired_at = COALESCE(retired_at, CURRENT_TIMESTAMP)
WHERE collection = 'training'
  AND id IN (
    'training_1',
    'training_2',
    'training_3',
    'training_4',
    'training_5',
    'training_6',
    'training_7',
    'training_8',
    'training_9',
    'training_10'
  );
