-- STEP 5B: durable cross-instance ownership for automatic post-Reveal review.
ALTER TABLE rv_sessions ADD COLUMN post_reveal_review_lease_owner TEXT;
ALTER TABLE rv_sessions ADD COLUMN post_reveal_review_lease_expires_at TEXT;
ALTER TABLE rv_sessions ADD COLUMN post_reveal_review_lease_version INTEGER NOT NULL DEFAULT 0;
