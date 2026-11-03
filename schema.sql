-- Dugout Hitting League - PostgreSQL Production Schema
-- Safe DDL for provisioning fresh databases or auditing tables

CREATE TABLE IF NOT EXISTS leagues (
  id TEXT NOT NULL,
  season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, season)
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  league TEXT NOT NULL,
  players JSONB NOT NULL,
  subs JSONB DEFAULT '[]',
  season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  league TEXT NOT NULL,
  home_team_id TEXT,
  away_team_id TEXT,
  date TIMESTAMPTZ NOT NULL,
  is_complete BOOLEAN DEFAULT FALSE,
  innings JSONB NOT NULL,
  season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY'),
  location TEXT,
  start_time TEXT,
  end_time TEXT,
  notes TEXT,
  status TEXT DEFAULT 'SCHEDULED',
  is_practice BOOLEAN DEFAULT FALSE,
  tie_breaker JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes for high performance querying
CREATE INDEX IF NOT EXISTS idx_matches_league_season ON matches (league, season);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches (date DESC);
CREATE INDEX IF NOT EXISTS idx_matches_practice ON matches (is_practice);
CREATE INDEX IF NOT EXISTS idx_teams_league_season ON teams (league, season);
