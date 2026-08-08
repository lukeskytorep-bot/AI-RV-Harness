CREATE TRIGGER IF NOT EXISTS trg_post_reveal_append_only
BEFORE UPDATE OF post_reveal_transcript ON rv_sessions
WHEN NEW.post_reveal_transcript <> OLD.post_reveal_transcript
BEGIN
  SELECT CASE
    WHEN OLD.state NOT IN ('Revealed', 'Completed')
      THEN RAISE(ABORT, 'post-reveal discussion requires Reveal')
    WHEN length(NEW.post_reveal_transcript) < length(OLD.post_reveal_transcript)
      OR substr(NEW.post_reveal_transcript, 1, length(OLD.post_reveal_transcript)) <> OLD.post_reveal_transcript
      THEN RAISE(ABORT, 'post-reveal transcript is append-only')
    WHEN OLD.research_project_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM research_projects rp
         WHERE rp.id = OLD.research_project_id AND rp.scores_frozen_at IS NOT NULL
      )
      THEN RAISE(ABORT, 'Research post-reveal discussion requires frozen scores')
  END;
END;
