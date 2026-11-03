#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { Match, Team, Player, Inning } from '../types';

import {
  migrateCrushersInDbData,
  isDuplicateCrushersName,
  isOfficialCrushersName,
  OFFICIAL_TEAM_NAME
} from '../utils/crushersMigration';
import type { MergeCrushersResult } from '../utils/crushersMigration';

export {
  migrateCrushersInDbData,
  isDuplicateCrushersName,
  isOfficialCrushersName,
  OFFICIAL_TEAM_NAME
};
export type { MergeCrushersResult };

/**
 * Runs migration against PostgreSQL database if DATABASE_URL or POSTGRES_URL is configured.
 */
export async function migrateCrushersInPostgres(connString?: string): Promise<MergeCrushersResult> {
  const url = connString || process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (!url) {
    return {
      success: true,
      teamsMerged: 0,
      teamsRenamed: 0,
      matchesUpdated: 0,
      finalizedMatchesUpdated: 0,
      scheduledMatchesUpdated: 0,
      playersMigrated: 0,
      details: ['No PostgreSQL connection string provided; skipped PG migration.']
    };
  }

  const pool = new pg.Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000
  });

  const result: MergeCrushersResult = {
    success: true,
    teamsMerged: 0,
    teamsRenamed: 0,
    matchesUpdated: 0,
    finalizedMatchesUpdated: 0,
    scheduledMatchesUpdated: 0,
    playersMigrated: 0,
    details: []
  };

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Find all duplicate and official teams
      const { rows: crushersTeams } = await client.query(
        `SELECT id, name, league, season, players, subs FROM teams WHERE LOWER(TRIM(name)) IN ('c-c-crushers', 'c-c-crushers!')`
      );

      const duplicates = crushersTeams.filter(t => isDuplicateCrushersName(t.name));
      const officials = crushersTeams.filter(t => isOfficialCrushersName(t.name));

      for (const dup of duplicates) {
        const primary = officials.find(
          o => o.league.trim().toLowerCase() === dup.league.trim().toLowerCase() &&
               (o.season || '2026') === (dup.season || '2026')
        ) || officials.find(o => o.league.trim().toLowerCase() === dup.league.trim().toLowerCase());

        if (primary) {
          result.details.push(`[PG] Merging team ${dup.name} (${dup.id}) into ${primary.name} (${primary.id})`);

          // 1. Build Player Mapping & Merge Rosters
          const playerMap = new Map<string, string>(); // dupPlayerId -> primaryPlayerId
          const primaryPlayers = typeof primary.players === 'string' ? JSON.parse(primary.players) : (primary.players || []);
          const dupPlayers = typeof dup.players === 'string' ? JSON.parse(dup.players) : (dup.players || []);
          const primarySubs = typeof primary.subs === 'string' ? JSON.parse(primary.subs) : (primary.subs || []);
          const dupSubs = typeof dup.subs === 'string' ? JSON.parse(dup.subs) : (dup.subs || []);

          const allDupPlayers = [...dupPlayers, ...dupSubs];

          for (const dp of allDupPlayers) {
            const dpCleanName = (dp.name || '').trim().toLowerCase();
            const existingPrimary =
              primaryPlayers.find((p: any) => (p.name || '').trim().toLowerCase() === dpCleanName) ||
              primarySubs.find((p: any) => (p.name || '').trim().toLowerCase() === dpCleanName);

            if (existingPrimary) {
              playerMap.set(dp.id, existingPrimary.id);
            } else {
              // Replace placeholder player if present
              const placeholderIdx = primaryPlayers.findIndex(
                (p: any) => p.name?.includes('Player ') && !dp.name?.includes('Player ')
              );
              if (placeholderIdx !== -1) {
                primaryPlayers[placeholderIdx].name = dp.name;
                if (dp.lastName) primaryPlayers[placeholderIdx].lastName = dp.lastName;
                playerMap.set(dp.id, primaryPlayers[placeholderIdx].id);
              } else {
                primaryPlayers.push({ ...dp });
                playerMap.set(dp.id, dp.id);
                result.playersMigrated++;
              }
            }
          }

          // Update primary team's roster in teams table
          await client.query(
            `UPDATE teams SET players = $1, subs = $2 WHERE id = $3`,
            [JSON.stringify(primaryPlayers), JSON.stringify(primarySubs), primary.id]
          );

          // 2. Relational Child-Record Migrations (if separate tables exist in database)
          const { rows: tableChecks } = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
              AND table_name IN ('players', 'team_rosters', 'rosters', 'player_stats', 'box_scores')
          `);
          const existingTables = new Set(tableChecks.map(r => r.table_name));

          // A. Migrate relational 'players' table
          if (existingTables.has('players')) {
            const { rows: dupRelPlayers } = await client.query(
              `SELECT id, name FROM players WHERE team_id = $1`,
              [dup.id]
            );
            for (const rp of dupRelPlayers) {
              const cleanRpName = (rp.name || '').trim().toLowerCase();
              const { rows: primaryRelPlayers } = await client.query(
                `SELECT id FROM players WHERE team_id = $1 AND LOWER(TRIM(name)) = $2 LIMIT 1`,
                [primary.id, cleanRpName]
              );
              if (primaryRelPlayers.length > 0) {
                // Map to existing player and remove duplicate row
                playerMap.set(rp.id, primaryRelPlayers[0].id);
                await client.query(`DELETE FROM players WHERE id = $1`, [rp.id]);
              } else {
                // Re-point player to official team
                await client.query(`UPDATE players SET team_id = $1 WHERE id = $2`, [primary.id, rp.id]);
                if (!playerMap.has(rp.id)) playerMap.set(rp.id, rp.id);
              }
            }
          }

          // B. Migrate relational roster junction tables
          if (existingTables.has('team_rosters')) {
            await client.query(
              `UPDATE team_rosters SET team_id = $1 WHERE team_id = $2 AND player_id NOT IN (SELECT player_id FROM team_rosters WHERE team_id = $1)`,
              [primary.id, dup.id]
            );
            await client.query(`DELETE FROM team_rosters WHERE team_id = $1`, [dup.id]);
          }
          if (existingTables.has('rosters')) {
            await client.query(
              `UPDATE rosters SET team_id = $1 WHERE team_id = $2 AND player_id NOT IN (SELECT player_id FROM rosters WHERE team_id = $1)`,
              [primary.id, dup.id]
            );
            await client.query(`DELETE FROM rosters WHERE team_id = $1`, [dup.id]);
          }

          // C. Migrate relational player_stats / box_scores tables
          if (existingTables.has('player_stats')) {
            await client.query(`UPDATE player_stats SET team_id = $1 WHERE team_id = $2`, [primary.id, dup.id]);
            for (const [dupPid, primaryPid] of playerMap.entries()) {
              if (dupPid !== primaryPid) {
                await client.query(`UPDATE player_stats SET player_id = $1 WHERE player_id = $2`, [primaryPid, dupPid]);
              }
            }
          }
          if (existingTables.has('box_scores')) {
            await client.query(`UPDATE box_scores SET team_id = $1 WHERE team_id = $2`, [primary.id, dup.id]);
            for (const [dupPid, primaryPid] of playerMap.entries()) {
              if (dupPid !== primaryPid) {
                await client.query(`UPDATE box_scores SET player_id = $1 WHERE player_id = $2`, [primaryPid, dupPid]);
              }
            }
          }

          // 3. Migrate Matches (Team IDs, Innings Box Scores, and Player Stats)
          const { rows: relatedMatches } = await client.query(
            `SELECT id, home_team_id, away_team_id, is_complete, innings, tie_breaker 
             FROM matches 
             WHERE home_team_id IN ($1, $2) OR away_team_id IN ($1, $2)`,
            [primary.id, dup.id]
          );

          for (const match of relatedMatches) {
            let matchChanged = false;
            let newHomeId = match.home_team_id;
            let newAwayId = match.away_team_id;

            if (match.home_team_id === dup.id) {
              newHomeId = primary.id;
              matchChanged = true;
            }
            if (match.away_team_id === dup.id) {
              newAwayId = primary.id;
              matchChanged = true;
            }

            // Remap innings box scores and player IDs
            let matchInnings = typeof match.innings === 'string' ? JSON.parse(match.innings) : (match.innings || []);
            if (Array.isArray(matchInnings)) {
              for (const ing of matchInnings) {
                ['home', 'away'].forEach(side => {
                  const teamSide = (ing as any)[side];
                  if (teamSide) {
                    if (teamSide.teamId === dup.id) {
                      teamSide.teamId = primary.id;
                      matchChanged = true;
                    }
                    if (Array.isArray(teamSide.playerScores)) {
                      for (const ps of teamSide.playerScores) {
                        if (playerMap.has(ps.playerId)) {
                          ps.playerId = playerMap.get(ps.playerId);
                          matchChanged = true;
                        }
                      }
                    }
                  }
                });
              }
            }

            // Remap tie breaker player IDs
            let matchTieBreaker = match.tie_breaker ? (typeof match.tie_breaker === 'string' ? JSON.parse(match.tie_breaker) : match.tie_breaker) : null;
            if (Array.isArray(matchTieBreaker)) {
              for (const tb of matchTieBreaker) {
                if (playerMap.has(tb.homePlayerId)) {
                  tb.homePlayerId = playerMap.get(tb.homePlayerId);
                  matchChanged = true;
                }
                if (playerMap.has(tb.awayPlayerId)) {
                  tb.awayPlayerId = playerMap.get(tb.awayPlayerId);
                  matchChanged = true;
                }
              }
            }

            if (matchChanged) {
              await client.query(
                `UPDATE matches SET home_team_id = $1, away_team_id = $2, innings = $3, tie_breaker = $4 WHERE id = $5`,
                [newHomeId, newAwayId, JSON.stringify(matchInnings), matchTieBreaker ? JSON.stringify(matchTieBreaker) : null, match.id]
              );
              result.matchesUpdated++;
              if (match.is_complete) {
                result.finalizedMatchesUpdated++;
              } else {
                result.scheduledMatchesUpdated++;
              }
            }
          }

          // 4. Delete Duplicate Team Record
          await client.query(`DELETE FROM teams WHERE id = $1`, [dup.id]);
          result.teamsMerged++;
        } else {
          // Simply rename if no official record exists yet
          await client.query(
            `UPDATE teams SET name = $1 WHERE id = $2`,
            [OFFICIAL_TEAM_NAME, dup.id]
          );
          result.teamsRenamed++;
          result.details.push(`[PG] Renamed team ${dup.id} to ${OFFICIAL_TEAM_NAME}`);
        }
      }

      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK');
      result.success = false;
      result.details.push(`[PG ERROR] ${err.message}`);
    } finally {
      client.release();
    }
  } catch (poolErr: any) {
    result.success = false;
    result.details.push(`[PG CONNECTION ERROR] ${poolErr.message}`);
  } finally {
    await pool.end().catch(() => {});
  }

  return result;
}

/**
 * Main execution function
 */
export async function main() {
  console.log('\n======================================================');
  console.log('⚾ TEAM MERGE & REPAIR: C-C-Crushers -> C-C-Crushers! ⚾');
  console.log('======================================================\n');

  let totalMerged = 0;
  let totalRenamed = 0;
  let totalMatches = 0;

  // 1. Process local JSON databases (.data/db.json and .data/seedData.json)
  const filesToProcess = [
    path.resolve(process.cwd(), '.data/db.json'),
    path.resolve(process.cwd(), '.data/seedData.json')
  ];

  for (const filePath of filesToProcess) {
    if (fs.existsSync(filePath)) {
      console.log(`📁 Inspecting storage file: ${filePath}`);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const db = JSON.parse(raw);
        const fileResult = migrateCrushersInDbData(db);

        if (fileResult.teamsMerged > 0 || fileResult.teamsRenamed > 0 || fileResult.matchesUpdated > 0) {
          fs.writeFileSync(filePath, JSON.stringify(db, null, 2), 'utf-8');
          console.log(`   ✅ Successfully updated ${filePath}:`);
          console.log(`      - Teams merged: ${fileResult.teamsMerged}`);
          console.log(`      - Teams renamed: ${fileResult.teamsRenamed}`);
          console.log(`      - Matches updated: ${fileResult.matchesUpdated} (${fileResult.finalizedMatchesUpdated} finalized, ${fileResult.scheduledMatchesUpdated} scheduled)`);
          fileResult.details.forEach(d => console.log(`      * ${d}`));
        } else {
          console.log(`   ℹ️ No duplicate "C-C-Crushers" entries found in ${path.basename(filePath)}.`);
        }

        totalMerged += fileResult.teamsMerged;
        totalRenamed += fileResult.teamsRenamed;
        totalMatches += fileResult.matchesUpdated;
      } catch (err: any) {
        console.error(`   ❌ Failed to process ${filePath}:`, err.message);
      }
    }
  }

  // 2. Process PostgreSQL if connection configured
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
    console.log('\n🐘 Connecting to PostgreSQL database...');
    const pgResult = await migrateCrushersInPostgres();
    if (pgResult.success) {
      console.log('   ✅ PostgreSQL migration completed:');
      console.log(`      - Teams merged: ${pgResult.teamsMerged}`);
      console.log(`      - Teams renamed: ${pgResult.teamsRenamed}`);
      console.log(`      - Matches updated: ${pgResult.matchesUpdated}`);
      pgResult.details.forEach(d => console.log(`      * ${d}`));
      totalMerged += pgResult.teamsMerged;
      totalRenamed += pgResult.teamsRenamed;
      totalMatches += pgResult.matchesUpdated;
    } else {
      console.error('   ❌ PostgreSQL migration encountered issues:');
      pgResult.details.forEach(d => console.error(`      * ${d}`));
    }
  } else {
    console.log('\nℹ️ No DATABASE_URL or POSTGRES_URL set; PostgreSQL migration skipped (local file storage cleaned).');
  }

  console.log('\n======================================================');
  console.log(`🎉 Migration summary: ${totalMerged} teams merged, ${totalRenamed} renamed, ${totalMatches} matches updated.`);
  console.log(`⚾ Official team name is: "${OFFICIAL_TEAM_NAME}"`);
  console.log('======================================================\n');
}

// Run CLI if executed directly
if (process.argv[1] && process.argv[1].endsWith('fix-crushers-team-name.ts')) {
  main().catch(err => {
    console.error('Fatal migration error:', err);
    process.exit(1);
  });
}
