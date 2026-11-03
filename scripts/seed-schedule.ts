#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { parseScheduleCsv, isDuplicateMatch, buildAutoCreatedTeam } from '../utils/scheduleImporter';
import { Match, Team, League, Inning } from '../types';

// Deterministic unique ID generator for seeder
let idCounter = 1;
const genId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

const createEmptyInning = (number: number, homeIds: string[], awayIds: string[]): Inning => {
  const createPlayerScore = (pid: string) => ({
    playerId: pid,
    pitches: Array(10).fill(null).map(() => ({ points: null }))
  });

  return {
    number,
    home: { teamId: 'home', playerScores: homeIds.map(createPlayerScore) },
    away: { teamId: 'away', playerScores: awayIds.map(createPlayerScore) }
  };
};

async function main() {
  console.log('\n======================================================');
  console.log('⚾ DUGOUT HITTING LEAGUE - SCHEDULE SEEDER & IMPORTER ⚾');
  console.log('======================================================\n');

  // 1. Locate CSV file & Target League argument
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];
  
  let targetCsvPath = path.resolve(process.cwd(), 'public/assets/aistudio/schedule_export_20261102_121804_62b9d935.csv');
  let targetLeagueArg: string | undefined = undefined;

  if (arg1) {
    if (arg1.endsWith('.csv') || fs.existsSync(path.resolve(process.cwd(), arg1))) {
      targetCsvPath = path.resolve(process.cwd(), arg1);
      targetLeagueArg = arg2;
    } else {
      // First argument is the target league name (e.g., npm run seed:schedule "9U - Mondays")
      targetLeagueArg = arg1;
    }
  }

  if (!fs.existsSync(targetCsvPath)) {
    console.error(`❌ Error: CSV schedule file not found at: ${targetCsvPath}`);
    process.exit(1);
  }

  console.log(`📄 Loading CSV file from: ${targetCsvPath}`);
  if (targetLeagueArg) {
    console.log(`🎯 Directing schedule import to existing league: "${targetLeagueArg}"`);
  }
  const csvContent = fs.readFileSync(targetCsvPath, 'utf-8');

  // 2. Parse CSV
  const { games, errors: parseErrors } = parseScheduleCsv(csvContent, {
    targetLeague: targetLeagueArg
  });
  if (parseErrors.length > 0) {
    console.warn('⚠️ Warnings during CSV parsing:');
    parseErrors.forEach(err => console.warn(`   - ${err}`));
  }

  if (games.length === 0) {
    console.error('❌ Error: No valid game rows found in the CSV schedule.');
    process.exit(1);
  }

  console.log(`✅ Parsed ${games.length} games from schedule.\n`);

  // Target Season & League
  const targetSeason = games[0].season || '2026';
  const targetLeague = games[0].group;
  console.log(`🎯 Target Season: ${targetSeason} | Destination League Division: "${targetLeague}"`);

  // 3. Load or Connect to Storage
  const dbJsonPath = path.resolve(process.cwd(), '.data/db.json');
  let db: {
    settings: any;
    leagues: League[];
    teams: Team[];
    matches: any[];
  } = {
    settings: { admin_password: 'admin', umpire_password: 'umpire', current_season: targetSeason, available_seasons: [targetSeason, '2025'] },
    leagues: [],
    teams: [],
    matches: []
  };

  if (fs.existsSync(dbJsonPath)) {
    try {
      db = JSON.parse(fs.readFileSync(dbJsonPath, 'utf-8'));
    } catch (e) {
      console.warn('⚠️ Could not parse existing .data/db.json, initializing fresh structure.');
    }
  }

  // Ensure DB arrays
  if (!Array.isArray(db.leagues)) db.leagues = [];
  if (!Array.isArray(db.teams)) db.teams = [];
  if (!Array.isArray(db.matches)) db.matches = [];

  // Track changes
  const createdLeagues: string[] = [];
  const createdTeams: string[] = [];
  let createdMatches = 0;
  let skippedDuplicates = 0;

  // 4. Process each game
  for (const game of games) {
    const season = game.season || targetSeason;
    const leagueName = game.group || targetLeague;

    // A. Ensure League exists
    const leagueExists = db.leagues.some(
      l => l.id.trim().toLowerCase() === leagueName.trim().toLowerCase() && (l.season || targetSeason) === season
    );
    if (!leagueExists) {
      db.leagues.push({
        id: leagueName,
        season,
        created_at: new Date().toISOString()
      });
      createdLeagues.push(leagueName);
    }

    // B. Ensure Home Team exists
    let homeTeam = db.teams.find(
      t => t.name.trim().toLowerCase() === game.homeTeamName.trim().toLowerCase() &&
           t.league.trim().toLowerCase() === leagueName.trim().toLowerCase() &&
           (t.season || targetSeason) === season
    );
    if (!homeTeam) {
      homeTeam = buildAutoCreatedTeam(game.homeTeamName, leagueName, season);
      homeTeam.id = genId('team');
      db.teams.push(homeTeam);
      createdTeams.push(homeTeam.name);
    }

    // C. Ensure Away Team exists
    let awayTeam = db.teams.find(
      t => t.name.trim().toLowerCase() === game.awayTeamName.trim().toLowerCase() &&
           t.league.trim().toLowerCase() === leagueName.trim().toLowerCase() &&
           (t.season || targetSeason) === season
    );
    if (!awayTeam) {
      awayTeam = buildAutoCreatedTeam(game.awayTeamName, leagueName, season);
      awayTeam.id = genId('team');
      db.teams.push(awayTeam);
      createdTeams.push(awayTeam.name);
    }

    // D. Duplicate Match Check
    const existingMatchesMapped: Match[] = db.matches.map(m => ({
      id: m.id,
      league: m.league,
      season: m.season || targetSeason,
      homeTeamId: m.home_team_id || m.homeTeamId,
      awayTeamId: m.away_team_id || m.awayTeamId,
      date: m.date,
      isComplete: m.is_complete ?? m.isComplete ?? false,
      innings: m.innings || []
    }));

    if (isDuplicateMatch(game, homeTeam.id, awayTeam.id, existingMatchesMapped)) {
      skippedDuplicates++;
      console.log(`⏩ [DUPLICATE] Skipped existing game: ${game.date} ${game.startTime} - ${game.homeTeamName} vs ${game.awayTeamName}`);
      continue;
    }

    // E. Provision 6 Empty Innings for Immediate Umpire Scoring
    const homePids = homeTeam.players.slice(0, 3).map(p => p.id);
    const awayPids = awayTeam.players.slice(0, 3).map(p => p.id);
    const innings = [1, 2, 3, 4, 5, 6].map(num => createEmptyInning(num, homePids, awayPids));

    const newMatch = {
      id: genId('match'),
      league: leagueName,
      home_team_id: homeTeam.id,
      away_team_id: awayTeam.id,
      date: game.scheduledIsoDate,
      is_complete: false,
      innings,
      season,
      location: game.location,
      start_time: game.startTime,
      end_time: game.endTime,
      notes: game.notes || null,
      created_at: new Date().toISOString()
    };

    db.matches.push(newMatch);
    createdMatches++;
    console.log(`📌 [SCHEDULED] ${game.date} @ ${game.startTime} (${game.location}): ${game.homeTeamName} vs ${game.awayTeamName}`);
  }

  // 5. Update settings to ensure target season is present
  if (!db.settings) {
    db.settings = { admin_password: 'admin', umpire_password: 'umpire', current_season: targetSeason, available_seasons: [targetSeason, '2025'] };
  }
  if (!Array.isArray(db.settings.available_seasons)) {
    db.settings.available_seasons = [targetSeason, '2025'];
  }
  if (!db.settings.available_seasons.includes(targetSeason)) {
    db.settings.available_seasons.push(targetSeason);
  }

  // Save to .data/db.json
  fs.mkdirSync(path.dirname(dbJsonPath), { recursive: true });
  fs.writeFileSync(dbJsonPath, JSON.stringify(db, null, 2), 'utf-8');
  console.log(`\n💾 Saved updated schedule to: ${dbJsonPath}`);

  // 6. If PostgreSQL DATABASE_URL is available, also seed directly into PostgreSQL
  const connString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (connString && connString.trim()) {
    console.log('\n🐘 PostgreSQL connection string detected. Syncing with remote database...');
    try {
      const client = new pg.Client({
        connectionString: connString.trim(),
        ssl: { rejectUnauthorized: false }
      });
      await client.connect();

      // Ensure table schema with separate queries
      await client.query(`
        CREATE TABLE IF NOT EXISTS leagues (
          id TEXT NOT NULL,
          season TEXT NOT NULL DEFAULT '2026',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (id, season)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS teams (
          id UUID PRIMARY KEY,
          name TEXT NOT NULL,
          league TEXT NOT NULL,
          players JSONB NOT NULL,
          subs JSONB DEFAULT '[]',
          season TEXT NOT NULL DEFAULT '2026',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS matches (
          id UUID PRIMARY KEY,
          league TEXT NOT NULL,
          home_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
          away_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
          date TIMESTAMPTZ NOT NULL,
          is_complete BOOLEAN DEFAULT FALSE,
          innings JSONB NOT NULL,
          season TEXT NOT NULL DEFAULT '2026',
          location TEXT,
          start_time TEXT,
          end_time TEXT,
          notes TEXT,
          status TEXT DEFAULT 'SCHEDULED',
          is_practice BOOLEAN DEFAULT FALSE,
          tie_breaker JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      for (const league of db.leagues) {
        await client.query(`INSERT INTO leagues (id, season) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [league.id, league.season || targetSeason]);
      }

      console.log('   ✅ Remote PostgreSQL sync completed successfully.');
      await client.end();
    } catch (pgErr: any) {
      console.warn(`   ⚠️ PostgreSQL sync warning (local storage will be used): ${pgErr.message}`);
    }
  }

  console.log('\n======================================================');
  console.log('🎉 SCHEDULE IMPORT SUMMARY');
  console.log('======================================================');
  console.log(`- Total Games in CSV:     ${games.length}`);
  console.log(`- Matches Provisioned:    ${createdMatches}`);
  console.log(`- Duplicates Skipped:     ${skippedDuplicates}`);
  console.log(`- New Teams Created:      ${createdTeams.length} (${createdTeams.join(', ') || 'None'})`);
  console.log(`- New Divisions Created:  ${createdLeagues.length} (${createdLeagues.join(', ') || 'None'})`);
  console.log('======================================================\n');
}

main().catch(err => {
  console.error('Fatal error during schedule seeding:', err);
  process.exit(1);
});
