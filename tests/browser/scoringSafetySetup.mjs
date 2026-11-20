import pg from 'pg';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const connectionString = process.env.DUGOUT_BROWSER_DATABASE_URL || '';
const url = new URL(connectionString);
if (url.hostname !== '127.0.0.1' || !['/dugout_test_phase2_browser', '/dugout_test_fan_scroll_browser'].includes(url.pathname)) throw new Error('Scoring browser fixtures require the disposable localhost database.');
const db = new pg.Client({ connectionString, ssl: false }); await db.connect();
await db.query(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
await db.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_forfeit BOOLEAN DEFAULT FALSE, ADD COLUMN IF NOT EXISTS forfeiting_team_id TEXT,
  ADD COLUMN IF NOT EXISTS forfeit_reason TEXT, ADD COLUMN IF NOT EXISTS winning_team_id TEXT;
  CREATE TABLE IF NOT EXISTS scoring_locks(match_id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,updated_at TIMESTAMPTZ DEFAULT NOW());`);
// Fresh identifiers on each run; no fixture or user data is deleted.
const league = `Scoring Safety ${randomUUID()}`;
await db.query("INSERT INTO app_settings(key,value) VALUES('current_season','2026') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value");
await db.query('INSERT INTO leagues(id,season) VALUES($1,$2)', [league, '2026']);
const home = { id: randomUUID(), name: 'Home Test', players: ['Alpha', 'Bravo', 'Charlie'].map(name => ({ id: randomUUID(), name })), subs: [{ id: randomUUID(), name: 'Sub Test' }] };
const away = { id: randomUUID(), name: 'Away Test', players: ['Delta', 'Echo', 'Foxtrot'].map(name => ({ id: randomUUID(), name })), subs: [] };
for (const t of [home, away]) await db.query('INSERT INTO teams(id,name,league,season,players,subs) VALUES($1,$2,$3,$4,$5,$6)', [t.id, t.name, league, '2026', JSON.stringify(t.players), JSON.stringify(t.subs)]);
const ids = {};
for (const scenario of ['hanging', 'lost-response', 'storage', 'stale-profile', 'duplicate-tabs', 'extras-five', 'extras-three', 'extras-one', 'finalize', 'two-player', 'substitution', 'initial-extras', 'incomplete-extras', 'edit-tie']) {
  const id = randomUUID(); ids[scenario] = id;
  const hc = scenario === 'two-player' ? 2 : 3;
  const innings = Array.from({ length: 6 }, (_, i) => ({ number: i + 1,
    home: { teamId: 'home', playerScores: home.players.slice(0, hc).map(p => ({ playerId: p.id, pitches: Array.from({ length: hc === 2 ? 15 : 10 }, () => ({ points: null })) })) },
    away: { teamId: 'away', playerScores: away.players.map(p => ({ playerId: p.id, pitches: Array.from({ length: 10 }, () => ({ points: null })) })) },
  }));
  let extras = null;
  if (scenario.startsWith('extras-') || scenario === 'finalize' || scenario === 'initial-extras' || scenario === 'edit-tie') {
    for (const i of innings) for (const side of ['home', 'away']) for (const p of i[side].playerScores) for (const pitch of p.pitches) pitch.points = 0;
    if (scenario === 'edit-tie') { /* fully recorded tie for correction/takeover */ }
    else if (scenario === 'initial-extras') { innings[5].home.playerScores[2].pitches[9].points = null; }
    else if (scenario === 'finalize') { innings[0].away.playerScores[0].pitches[0].points = 1; innings[5].home.playerScores[2].pitches[9].points = null; }
    else {
      const rounds = scenario === 'extras-five' ? 1 : scenario === 'extras-three' ? 2 : 3;
      extras = [5, 3, 1].slice(0, rounds).map((n, index) => ({ roundNumber: index + 1, pitchLimit: n, homePlayerId: home.players[0].id, awayPlayerId: away.players[0].id,
        homeScores: Array(n).fill(index === rounds - 1 ? null : 0), awayScores: Array(n).fill(index === rounds - 1 ? null : 0) }));
    }
  }
  await db.query('INSERT INTO matches(id,league,season,home_team_id,away_team_id,date,start_time,end_time,location,status,innings,tie_breaker) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [id, league, '2026', home.id, away.id, '2026-11-17T18:00:00Z', '6:00 pm', '7:00 pm', 'The Dugout: Tunnels 5/6', 'IN_PROGRESS', JSON.stringify(innings), extras ? JSON.stringify(extras) : null]);
}
// A dedicated finalized game exercises dashboard corrections without opening
// Scoreboard first (which would hide a missing-lock defect).
const statsAwayId = randomUUID();
await db.query('INSERT INTO teams(id,name,league,season,players,subs) VALUES($1,$2,$3,$4,$5,$6)',
  [statsAwayId, 'Stats Repair Away', league, '2026', JSON.stringify(away.players), '[]']);
const statsInnings = Array.from({ length: 6 }, (_, i) => ({ number: i + 1,
  home: { teamId: 'home', playerScores: home.players.map(p => ({ playerId: p.id, pitches: Array.from({ length: 10 }, () => ({ points: 0 })) })) },
  away: { teamId: 'away', playerScores: away.players.map(p => ({ playerId: p.id, pitches: Array.from({ length: 10 }, () => ({ points: 0 })) })) },
}));
statsInnings[5].home.playerScores[2].pitches[9].points = 2;
ids['stats-repair'] = randomUUID();
await db.query('INSERT INTO matches(id,league,season,home_team_id,away_team_id,date,status,is_complete,innings,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [ids['stats-repair'], league, '2026', home.id, statsAwayId, '2026-11-17T18:00:00Z', 'FINAL', true, JSON.stringify(statsInnings), 'The Dugout: Tunnels 5/6']);
mkdirSync('work/browser', { recursive: true });
writeFileSync('work/browser/scoring-fixtures.json', JSON.stringify({ league, ids, home, away }));
await db.end(); console.log('Synthetic scoring scenarios prepared. No Neon database or existing game was used.');
