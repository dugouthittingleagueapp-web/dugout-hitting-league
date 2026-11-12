-- Dugout Hitting League: one-time baseline for an EXISTING database.
-- REVIEW AND BACK UP before use. NEVER run automatically during deployment.
-- Validated on an isolated Neon test copy on 2026-11-12.
-- Run only after inspecting the destination schema and receiving explicit approval.
DO $baseline$
DECLARE
  core_tables integer;
BEGIN
  SELECT count(*) INTO core_tables FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('leagues','teams','matches','app_settings');
  IF core_tables <> 4 THEN RAISE EXCEPTION 'Core tables missing'; END IF;
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'Already has migration history; refusing to rebaseline';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='matches'
        AND column_name IN ('is_practice','is_forfeit','forfeiting_team_id','forfeit_reason','season')) <> 5 THEN
    RAISE EXCEPTION 'Required match columns missing';
  END IF;
  IF (SELECT count(*) FROM app_settings
      WHERE key IN ('admin_password','umpire_password')
        AND left(value,4) IN ('$2a$','$2b$','$2y$') AND length(value)=60) <> 2 THEN
    RAISE EXCEPTION 'Passwords not in expected bcrypt format';
  END IF;
  IF EXISTS (SELECT 1 FROM matches WHERE is_practice IS NULL) THEN
    RAISE EXCEPTION 'NULL practice flag: manual remediation required';
  END IF;
  ALTER TABLE matches ALTER COLUMN is_practice SET NOT NULL;
  ALTER TABLE matches ALTER COLUMN is_practice SET DEFAULT FALSE;
  CREATE INDEX IF NOT EXISTS idx_matches_league_season ON matches (LOWER(league), season);
  CREATE INDEX IF NOT EXISTS idx_matches_practice ON matches (is_practice);
  CREATE INDEX IF NOT EXISTS idx_matches_complete ON matches (is_complete, status);
  CREATE INDEX IF NOT EXISTS idx_matches_date_time ON matches (date ASC, start_time ASC);
  CREATE INDEX IF NOT EXISTS idx_teams_league_season ON teams (LOWER(league), season);
  CREATE INDEX IF NOT EXISTS idx_matches_forfeit ON matches (is_forfeit);
  CREATE TABLE schema_migrations(
    version integer PRIMARY KEY,
    name text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
  INSERT INTO schema_migrations(version,name) VALUES
    (1,'001_core_tables'),(2,'002_harden_practice_and_indexes'),
    (3,'003_secure_passwords_and_settings'),(4,'004_forfeit_columns');
END $baseline$;
