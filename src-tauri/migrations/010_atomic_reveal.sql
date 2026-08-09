CREATE TRIGGER IF NOT EXISTS prevent_reveal_for_unsealed_session
BEFORE INSERT ON reveals
WHEN COALESCE((SELECT state FROM rv_sessions WHERE id = NEW.session_id), '') <> 'AwaitingReveal'
BEGIN
  SELECT RAISE(ABORT, 'Reveal requires a sealed pre-reveal session');
END;

CREATE TRIGGER IF NOT EXISTS mark_session_revealed_atomically
AFTER INSERT ON reveals
BEGIN
  UPDATE rv_sessions
     SET state = 'Revealed', updated_at = NEW.accepted_at
   WHERE id = NEW.session_id;
END;
