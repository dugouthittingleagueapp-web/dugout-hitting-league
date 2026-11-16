import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const url = new URL(process.env.DUGOUT_BROWSER_DATABASE_URL || '');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/dugout_test_release_browser')
  throw new Error('Lineup fixtures require the isolated localhost scoring test database.');
const db = new pg.Client({ connectionString: url.toString(), ssl: false });
await db.connect();
const league = `Lineup Entry QC ${randomUUID()}`;
await db.query("INSERT INTO app_settings(key,value) VALUES('current_season','2026') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value");
await db.query('INSERT INTO leagues(id,season) VALUES($1,$2)', [league, '2026']);
const home = { id: randomUUID(), name: 'Lineup Home', players: ['Alpha', 'Bravo', 'Charlie'].map(name => ({ id: randomUUID(), name })) };
const games = {};
for (const scenario of ['lineup', 'direct', 'owned', 'failure', 'lineup-only']) {
  const away = { id: randomUUID(), name: `Lineup Away ${scenario}`, players: ['Delta', 'Echo', 'Foxtrot'].map(name => ({ id: randomUUID(), name })) };
  for (const team of scenario === 'lineup' ? [home, away] : [away])
    await db.query('INSERT INTO teams(id,name,league,season,players,subs) VALUES($1,$2,$3,$4,$5,$6)', [team.id, team.name, league, '2026', JSON.stringify(team.players), '[]']);
  const innings = Array.from({ length: 6 }, (_, i) => ({ number: i + 1,
    home: { teamId: 'home', playerScores: home.players.map(p => ({ playerId: p.id, pitches: Array.from({ length: 10 }, () => ({ points: null })) })) },
    away: { teamId: 'away', playerScores: away.players.map(p => ({ playerId: p.id, pitches: Array.from({ length: 10 }, () => ({ points: null })) })) },
  }));
  const id = randomUUID(); games[scenario] = { id, away };
  await db.query('INSERT INTO matches(id,league,season,home_team_id,away_team_id,date,status,innings,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, league, '2026', home.id, away.id, '2026-11-17T18:00:00Z', 'SCHEDULED', JSON.stringify(innings), 'The Dugout: Tunnels 7/8']);
}
mkdirSync('work/browser', { recursive: true });
writeFileSync('work/browser/lineup-fixtures.json', JSON.stringify({ league, home, games }));
await db.end();
console.log('Fresh scheduled lineup fixtures created in localhost test database only.');
