-- Dugout Hitting League: additive scoring schema upgrade for Production.
-- NOT run automatically by the Vercel build.
-- Run ONLY after backing up the Production Neon main branch and after
-- explicit approval for the Production schema change.
--
-- This is deliberately limited to columns/tables required by the scoring
-- concurrency protections. Existing games, teams, players, and stats are
-- not copied, updated, truncated, or deleted.
BEGIN;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS scoring_locks (
  match_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
