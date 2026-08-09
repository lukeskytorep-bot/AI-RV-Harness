CREATE TRIGGER IF NOT EXISTS prevent_frozen_score_any_update
BEFORE UPDATE ON judge_scores
WHEN OLD.frozen_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'frozen Judge result is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_frozen_score_delete
BEFORE DELETE ON judge_scores
WHEN OLD.frozen_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'frozen Judge result is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_frozen_judge_run_update
BEFORE UPDATE ON judge_runs
WHEN EXISTS (
  SELECT 1 FROM judge_scores s WHERE s.judge_run_id = OLD.id AND s.frozen_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Judge run with frozen score is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_frozen_judge_run_delete
BEFORE DELETE ON judge_runs
WHEN EXISTS (
  SELECT 1 FROM judge_scores s WHERE s.judge_run_id = OLD.id AND s.frozen_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Judge run with frozen score is immutable');
END;
