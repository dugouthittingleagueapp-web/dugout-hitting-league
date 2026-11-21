-- Additive game-day monitoring only. Does not alter or reference scoring tables.
BEGIN;
CREATE TABLE IF NOT EXISTS diagnostic_events (
 event_id UUID PRIMARY KEY,
 operation_id UUID NOT NULL,
 correlation_id UUID NOT NULL,
 event_type VARCHAR(40) NOT NULL CHECK (event_type IN ('scoring_rejected','scoring_timeout','scoring_repeated_failure','scoring_conflict','ownership_conflict','recovery_started','recovery_completed','recovery_failed','recovery_manual_review','scoring_api_error','database_error','finalization_failed','schedule_rejected','schedule_failed')),
 severity VARCHAR(16) NOT NULL CHECK (severity IN ('critical','warning','information')),
 resolution VARCHAR(16) NOT NULL CHECK (resolution IN ('resolved','unresolved','unknown')),
 summary VARCHAR(256) NOT NULL,
 code VARCHAR(48) NOT NULL,
 route VARCHAR(40) NOT NULL,
 source VARCHAR(8) NOT NULL CHECK (source IN ('server','device')),
 game_id VARCHAR(100), league TEXT, season VARCHAR(4),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences BETWEEN 1 AND 1000000),
 UNIQUE(operation_id,event_type,source)
);
CREATE INDEX IF NOT EXISTS diagnostic_recent_idx ON diagnostic_events(last_seen_at DESC,event_id DESC);
CREATE INDEX IF NOT EXISTS diagnostic_game_idx ON diagnostic_events(game_id,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS diagnostic_league_idx ON diagnostic_events(league,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS diagnostic_unresolved_idx ON diagnostic_events(resolution,last_seen_at DESC);
COMMIT;
