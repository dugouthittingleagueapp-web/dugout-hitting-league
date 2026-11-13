-- One-time, manual baseline for EXISTING Dugout databases.
-- Never run automatically on Vercel, and never apply to Production without
-- separately approved backup, schema verification, and maintenance plan.
-- Tested on an isolated Neon review branch; does not touch match scores.
--
-- Guards intentionally fail rather than invent a history for an incompatible
-- or partially upgraded database. This file is NOT a Production authorization.
DO $baseline$
DECLARE
  count_core integer;
  has_locks boolean;
  has_revision boolean;
BEGIN
  SELECT count(*) INTO count_core
  FROM information_schema.tables
  WHERE table_schema='public'
    AND table_name IN ('leagues','teams','matches','app_settings');
  IF count_core <> 4 THEN
    RAISE EXCEPTION 'Expected all four existing application tables';
  END IF;
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration history already exists: do not re-baseline';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='matches'
        AND column_name IN ('is_practice','is_forfeit',
          'forfeiting_team_id','forfeit_reason','season')) <> 5 THEN
    RAISE EXCEPTION 'Legacy match schema is not ready for baseline';
  END IF;
  IF (SELECT count(*) FROM app_settings
      WHERE key IN ('admin_password','umpire_password')
        AND left(value,4) IN ('$2a$','$2b$','$2y$')
        AND length(value)=60) <> 2 THEN
    RAISE EXCEPTION 'Both password records must already be bcrypt-formatted';
  END IF;
  IF EXISTS (SELECT 1 FROM matches WHERE is_practice IS NULL) THEN
    RAISE EXCEPTION 'Practice flags have NULLs; review data before baseline';
  END IF;
  SELECT to_regclass('public.scoring_locks') IS NOT NULL INTO has_locks;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='matches'
      AND column_name='revision'
  ) INTO has_revision;
  IF has_locks <> has_revision THEN
    RAISE EXCEPTION 'Scoring lock and revision upgrades disagree';
  END IF;

  ALTER TABLE matches ALTER COLUMN is_practice SET NOT NULL;
  ALTER TABLE matches ALTER COLUMN is_practice SET DEFAULT FALSE;
  CREATE INDEX IF NOT EXISTS idx_matches_league_season ON matches (LOWER(league), season);
  CREATE INDEX IF NOT EXISTS idx_matches_practice ON matches (is_practice);
  CREATE INDEX IF NOT EXISTS idx_matches_complete ON matches (is_complete, status);
  CREATE INDEX IF NOT EXISTS idx_matches_date_time ON matches (date ASC, start_time ASC);
  CREATE INDEX IF NOT EXISTS idx_teams_league_season ON teams (LOWER(league), season);
  CREATE INDEX IF NOT EXISTS idx_matches_forfeit ON matches (is_forfeit);

  CREATE TABLE public.schema_migrations(
    version integer PRIMARY KEY,
    name text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
  INSERT INTO public.schema_migrations(version,name) VALUES
    (1,'001_core_tables'),
    (2,'002_harden_practice_and_indexes'),
    (3,'003_secure_passwords_and_settings'),
    (4,'004_forfeit_columns');
  IF has_locks AND has_revision THEN
    INSERT INTO public.schema_migrations(version,name) VALUES
      (5,'005_exclusive_scoring_locks'),
      (6,'006_match_revisions');
  END IF;
END $baseline$;
