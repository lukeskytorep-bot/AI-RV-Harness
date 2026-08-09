CREATE TRIGGER IF NOT EXISTS prevent_locked_research_method_update
BEFORE UPDATE OF workspace_id, name, template_type, config_json, config_hash ON research_projects
WHEN OLD.locked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'locked Research methodology is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_locked_condition_update
BEFORE UPDATE ON research_conditions
WHEN EXISTS (SELECT 1 FROM research_projects p WHERE p.id = OLD.research_project_id AND p.locked_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'locked Research conditions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_locked_condition_delete
BEFORE DELETE ON research_conditions
WHEN EXISTS (SELECT 1 FROM research_projects p WHERE p.id = OLD.research_project_id AND p.locked_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'locked Research conditions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_locked_assignment_plan_update
BEFORE UPDATE OF research_project_id, anonymous_session_id, target_id, execution_order, judge_order ON research_assignments
WHEN EXISTS (SELECT 1 FROM research_projects p WHERE p.id = OLD.research_project_id AND p.locked_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'locked Research assignment plan is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_locked_assignment_delete
BEFORE DELETE ON research_assignments
WHEN EXISTS (SELECT 1 FROM research_projects p WHERE p.id = OLD.research_project_id AND p.locked_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'locked Research assignments are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_locked_blinding_update
BEFORE UPDATE ON blinding_mappings
WHEN EXISTS (SELECT 1 FROM research_projects p WHERE p.id = OLD.research_project_id AND p.locked_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'Blinding Key is immutable after Experiment Lock');
END;

CREATE TRIGGER IF NOT EXISTS prevent_locked_blinding_delete
BEFORE DELETE ON blinding_mappings
WHEN EXISTS (SELECT 1 FROM research_projects p WHERE p.id = OLD.research_project_id AND p.locked_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'Blinding Key is immutable after Experiment Lock');
END;

CREATE TRIGGER IF NOT EXISTS prevent_unblind_before_scores_frozen
BEFORE UPDATE OF state, unblinded_at ON research_projects
WHEN (NEW.state IN ('Unblinded','Complete') OR NEW.unblinded_at IS NOT NULL)
 AND OLD.scores_frozen_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Research cannot unblind before all Judge scores are frozen');
END;

CREATE TRIGGER IF NOT EXISTS prevent_research_result_update
BEFORE UPDATE ON research_results
BEGIN
  SELECT RAISE(ABORT, 'Research results are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_research_result_delete
BEFORE DELETE ON research_results
BEGIN
  SELECT RAISE(ABORT, 'Research results are immutable');
END;
