-- Additive only. Apply to the isolated Preview database before deploying this feature.
CREATE TABLE IF NOT EXISTS league_players (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS player_identity_links (
  roster_player_id TEXT PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES league_players(id),
  resolution TEXT NOT NULL CHECK (resolution IN ('existing', 'confirmed', 'new', 'unreviewed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS player_identity_person_idx ON player_identity_links(player_id);
