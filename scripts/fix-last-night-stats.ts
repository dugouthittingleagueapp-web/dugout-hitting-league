#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { Team, Player } from '../types.js';
import { remapMatchPlayerIds } from '../utils/statsEditorHelper.js';

export interface FixLastNightStatsResult {
  success: boolean;
  matchId?: string;
  date?: string;
  teamsFound: string[];
  playersReassigned: number;
  statsRestored: {
    playerId: string;
    playerName: string;
    points: number;
    pitches: number;
  }[];
  details: string[];
}

export interface FixLastNightStatsOptions {
  dbPath?: string;
  connString?: string;
  manualPlayerMapping?: Record<string, string>; // placeholderPlayerId/Name -> targetPlayerId
  customRoster?: Array<{ name: string; lastName?: string }>;
}

export async function fixLastNightStats(options: FixLastNightStatsOptions = {}): Promise<FixLastNightStatsResult> {
  const result: FixLastNightStatsResult = {
    success: true,
    teamsFound: [],
    playersReassigned: 0,
    statsRestored: [],
    details: []
  };

  const connString = options.connString || process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (connString) {
    result.details.push('Executing database repair against PostgreSQL...');
    const pool = new pg.Pool({
      connectionString: connString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000
    });

    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Find C-C-Crushers! and AYRA Bright teams
        const { rows: teams } = await client.query(
          "SELECT id, name, league, season, players, subs FROM teams WHERE LOWER(TRIM(name)) LIKE '%crusher%' OR LOWER(TRIM(name)) LIKE '%bright%'"
        );

        const crushersTeam = teams.find(t => t.name.toLowerCase().includes('crusher'));
        const brightTeam = teams.find(t => t.name.toLowerCase().includes('bright'));

        if (!crushersTeam) {
          result.details.push('Warning: C-C-Crushers! team record not found in PostgreSQL.');
        } else {
          result.teamsFound.push(crushersTeam.name);
        }

        // 2. Find last night match (11/2/2026 or matches involving both teams)
        const { rows: matches } = await client.query(`
          SELECT * FROM matches 
          WHERE (date::text LIKE '2026-11-02%' OR date::text LIKE '2026-11-03%')
          ORDER BY date DESC
        `);

        let targetMatch = matches.find(m => {
          const hId = m.home_team_id || m.homeTeamId;
          const aId = m.away_team_id || m.awayTeamId;
          const isCrushers = (crushersTeam && (hId === crushersTeam.id || aId === crushersTeam.id));
          const isBright = (brightTeam && (hId === brightTeam.id || aId === brightTeam.id));
          return isCrushers || (isBright && isCrushers);
        });

        if (!targetMatch && matches.length > 0) {
          // Fallback to match where crushers is home or away
          targetMatch = matches[0];
        }

        if (!targetMatch) {
          result.details.push('No matches found for date 2026-11-02 in PostgreSQL.');
        } else {
          result.matchId = targetMatch.id;
          result.date = targetMatch.date;

          const innings = typeof targetMatch.innings === 'string' ? JSON.parse(targetMatch.innings) : targetMatch.innings;
          targetMatch.innings = innings;

          // Determine C-C-Crushers! side
          const hId = targetMatch.home_team_id || targetMatch.homeTeamId;
          const isCrushersHome = crushersTeam && hId === crushersTeam.id;
          const crushersSide: 'home' | 'away' = isCrushersHome ? 'home' : 'away';

          let parsedPlayers: Player[] = typeof crushersTeam?.players === 'string' ? JSON.parse(crushersTeam.players) : (crushersTeam?.players || []);

          // If official roster currently has generic placeholder names and custom roster is provided, update roster
          if (options.customRoster && options.customRoster.length > 0) {
            parsedPlayers = options.customRoster.map((p, idx) => ({
              id: parsedPlayers[idx]?.id || `player-crushers-${idx + 1}`,
              name: p.name,
              lastName: p.lastName
            }));
            await client.query('UPDATE teams SET players = $1 WHERE id = $2', [JSON.stringify(parsedPlayers), crushersTeam.id]);
            result.details.push(`Updated ${crushersTeam.name} official roster with real player names.`);
          }

          // Extract unlinked player stats in innings
          const mapping: Record<string, string> = { ...(options.manualPlayerMapping || {}) };
          const unlinkedSlots: { playerId: string; points: number; pitches: number }[] = [];

          (innings || []).forEach((ing: any) => {
            const teamData = ing[crushersSide];
            (teamData?.playerScores || []).forEach((ps: any, slotIdx: number) => {
              let existing = unlinkedSlots.find(u => u.playerId === ps.playerId);
              if (!existing) {
                existing = { playerId: ps.playerId, points: 0, pitches: 0 };
                unlinkedSlots.push(existing);
              }
              (ps.pitches || []).forEach((pt: any) => {
                if (pt && pt.points !== null) {
                  existing!.points += pt.points;
                  existing!.pitches++;
                }
              });

              // Map slot 0, 1, 2 to roster players 0, 1, 2 if not mapped
              if (!mapping[ps.playerId] && parsedPlayers[slotIdx]) {
                mapping[ps.playerId] = parsedPlayers[slotIdx].id;
              }
            });
          });

          // Remap innings
          const updatedMatch = remapMatchPlayerIds(targetMatch, mapping);
          await client.query(
            'UPDATE matches SET innings = $1, is_complete = TRUE, status = $2 WHERE id::text = $3',
            [JSON.stringify(updatedMatch.innings), 'FINAL', String(targetMatch.id)]
          );

          result.playersReassigned = Object.keys(mapping).length;

          unlinkedSlots.forEach((slot, idx) => {
            const targetPlayerId = mapping[slot.playerId];
            const targetPlayer = parsedPlayers.find(p => p.id === targetPlayerId);
            const targetName = targetPlayer ? `${targetPlayer.name} ${targetPlayer.lastName || ''}`.trim() : `Player ${idx + 1}`;
            result.statsRestored.push({
              playerId: targetPlayerId || slot.playerId,
              playerName: targetName,
              points: slot.points,
              pitches: slot.pitches
            });
          });

          result.details.push(`Successfully re-assigned ${result.playersReassigned} player stat slots in match ${targetMatch.id}.`);
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (e: any) {
      result.details.push(`PostgreSQL error: ${e.message}`);
    } finally {
      await pool.end().catch(() => {});
    }
  }

  // Also repair local db.json if present
  const dbFile = options.dbPath || path.resolve(process.cwd(), '.data/db.json');
  if (fs.existsSync(dbFile)) {
    try {
      const raw = fs.readFileSync(dbFile, 'utf8');
      const db = JSON.parse(raw);

      if (Array.isArray(db.matches) && Array.isArray(db.teams)) {
        const crushers = db.teams.find((t: Team) => t.name.toLowerCase().includes('crusher'));
        const bright = db.teams.find((t: Team) => t.name.toLowerCase().includes('bright'));

        const match = db.matches.find((m: any) => {
          const hId = m.home_team_id || m.homeTeamId;
          const aId = m.away_team_id || m.awayTeamId;
          const date = m.date || '';
          return date.startsWith('2026-11-02') && crushers && (hId === crushers.id || aId === crushers.id) && (!bright || hId === bright.id || aId === bright.id);
        });

        if (match && crushers) {
          result.matchId = match.id;
          result.date = match.date;

          let parsedPlayers: Player[] = crushers.players || [];
          if (options.customRoster && options.customRoster.length > 0) {
            parsedPlayers = options.customRoster.map((p, idx) => ({
              id: parsedPlayers[idx]?.id || `player-crushers-${idx + 1}`,
              name: p.name,
              lastName: p.lastName
            }));
            crushers.players = parsedPlayers;
          }

          const hId = match.home_team_id || match.homeTeamId;
          const crushersSide = hId === crushers.id ? 'home' : 'away';

          const mapping: Record<string, string> = { ...(options.manualPlayerMapping || {}) };
          (match.innings || []).forEach((ing: any) => {
            const teamData = ing[crushersSide];
            (teamData?.playerScores || []).forEach((ps: any, slotIdx: number) => {
              if (!mapping[ps.playerId] && parsedPlayers[slotIdx]) {
                mapping[ps.playerId] = parsedPlayers[slotIdx].id;
              }
            });
          });

          match.innings = remapMatchPlayerIds(match, mapping).innings;
          match.isComplete = true;
          match.is_complete = true;
          match.status = 'FINAL';

          fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8');
          result.details.push(`Repaired local match ${match.id} in .data/db.json.`);
        }
      }
    } catch (e: any) {
      result.details.push(`Local db.json repair notice: ${e.message}`);
    }
  }

  return result;
}

// Allow CLI execution: tsx scripts/fix-last-night-stats.ts
if (process.argv[1] && process.argv[1].endsWith('fix-last-night-stats.ts')) {
  console.log('🚀 Running Last Night Match Stats Repair for C-C-Crushers! vs AYRA Bright...');
  fixLastNightStats()
    .then(res => {
      console.log('✅ Repair Complete:');
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Repair Failed:', err);
      process.exit(1);
    });
}
