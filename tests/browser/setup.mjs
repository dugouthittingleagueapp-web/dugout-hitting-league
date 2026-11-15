import pg from 'pg';
import { readFileSync } from 'node:fs';

const connectionString = process.env.DUGOUT_BROWSER_DATABASE_URL || '';
const url = new URL(connectionString);
if (url.hostname !== '127.0.0.1' || url.pathname !== '/dugout_test_browser')
  throw new Error('Use the disposable localhost database dugout_test_browser only. Neon URLs are refused.');
const client = new pg.Client({connectionString,ssl:false});
await client.connect();
await client.query(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
await client.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_forfeit BOOLEAN DEFAULT FALSE, ADD COLUMN IF NOT EXISTS forfeiting_team_id TEXT,
  ADD COLUMN IF NOT EXISTS forfeit_reason TEXT, ADD COLUMN IF NOT EXISTS winning_team_id TEXT;
  CREATE TABLE IF NOT EXISTS scoring_locks (match_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());`);
// This is intentionally a reset of synthetic fixtures in the guarded local DB.
await client.query("TRUNCATE leagues, teams, matches, app_settings, scoring_locks; INSERT INTO app_settings VALUES ('current_season','2027'); INSERT INTO leagues (id,season) VALUES ('Archived League','2025');");
await client.end();
console.log('Disposable browser fixtures ready. No Neon connection was used.');
