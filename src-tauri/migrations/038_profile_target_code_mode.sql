ALTER TABLE profiles ADD COLUMN target_code_mode TEXT NOT NULL DEFAULT 'with_code'
  CHECK (target_code_mode IN ('with_code', 'without_code'));
