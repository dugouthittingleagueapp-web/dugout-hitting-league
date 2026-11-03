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

          // Step 1: Update finalized games Home and Away references
          const homeFinalRes = await client.query(
            `UPDATE matches SET home_team_id = $1 WHERE home_team_id = $2 AND is_complete = true`,
            [primary.id, dup.id]
          );
          const awayFinalRes = await client.query(
            `UPDATE matches SET away_team_id = $1 WHERE away_team_id = $2 AND is_complete = true`,
            [primary.id, dup.id]
          );
          const finalCount = (homeFinalRes.rowCount || 0) + (awayFinalRes.rowCount || 0);
          result.finalizedMatchesUpdated += finalCount;

          // Step 2: Update scheduled matches / future schedule
          const homeSchedRes = await client.query(
            `UPDATE matches SET home_team_id = $1 WHERE home_team_id = $2 AND (is_complete = false OR is_complete IS NULL)`,
            [primary.id, dup.id]
          );
          const awaySchedRes = await client.query(
            `UPDATE matches SET away_team_id = $1 WHERE away_team_id = $2 AND (is_complete = false OR is_complete IS NULL)`,
            [primary.id, dup.id]
          );
          const schedCount = (homeSchedRes.rowCount || 0) + (awaySchedRes.rowCount || 0);
          result.scheduledMatchesUpdated += schedCount;
          result.matchesUpdated += (finalCount + schedCount);

          // Step 3: Merge any roster entries from duplicate into official team
          const primaryPlayers = typeof primary.players === 'string' ? JSON.parse(primary.players) : (primary.players || []);
          const dupPlayers = typeof dup.players === 'string' ? JSON.parse(dup.players) : (dup.players || []);
          const existingNames = new Set(primaryPlayers.map((p: any) => (p.name || '').trim().toLowerCase()));
          const newPlayers = dupPlayers.filter((p: any) => !existingNames.has((p.name || '').trim().toLowerCase()));

          if (newPlayers.length > 0) {
            const mergedPlayers = [...primaryPlayers, ...newPlayers];
            await client.query(
              `UPDATE teams SET players = $1 WHERE id = $2`,
              [JSON.stringify(mergedPlayers), primary.id]
            );
            result.playersMigrated += newPlayers.length;
          }

          // Step 4: Delete duplicate team record
          await client.query(`DELETE FROM teams WHERE id = $1`, [dup.id]);
          result.teamsMerged++;
        } else {
          // Simply rename
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
