-- Run on the preview Neon database before testing the scoring lock.
-- Use the production database only as part of an approved deployment.
CREATE TABLE IF NOT EXISTS scoring_locks (
  match_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
