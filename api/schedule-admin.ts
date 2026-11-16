import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireRole } from './auth.js';
import { scheduleDateTimeError, canonicalCage } from '../utils/scheduleValidation.js';
import { withActiveSeason, ScheduleError, assertScheduleGamesUnlocked } from '../server/scheduleTransaction.js';
import { planScheduleImport, executeScheduleImport, importReceiptKey, previousImport } from '../server/scheduleImport.js';
import pool from './db.js';
import { createEmptyInning } from '../utils/inningTemplate.js';
import { readScheduleBookings } from '../server/scheduleBookings.js';
import { findScheduleConflicts } from '../utils/scheduleConflicts.js';

// Admin-only calendar maintenance. Do not route this through the normal scoring
// PUT endpoint: a schedule correction must not rewrite inning/pitch histories.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const role = requireRole(req, res, ['admin']);
  if (!role) return;
  if (!['GET', 'PATCH', 'POST'].includes(req.method || '')) return res.status(405).json({ error: 'Method not allowed' });

  const { action, season, id, revision, date, startTime, endTime, location, notes,
    homeTeamId, awayTeamId, teamName } = (req.method === 'GET' ? req.query : req.body) || {};
  if (typeof season !== 'string' || !/^\d{4}$/.test(season))
    return res.status(400).json({ error: 'Select a valid season.' });

  try {
    if (req.method === 'GET') {
      // Strict admin read: never replace a failed server load with cached/empty data.
      const active = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
      if (season !== active.rows[0]?.value) throw new ScheduleError(409, 'The active season changed. Refresh the admin dashboard.');
      const [leagues, teams, games] = await Promise.all([
        pool.query('SELECT id, season FROM leagues WHERE season = $1 ORDER BY id', [season]),
        pool.query('SELECT * FROM teams WHERE season = $1 ORDER BY name', [season]),
        pool.query('SELECT m.*, EXISTS (SELECT 1 FROM scoring_locks s WHERE s.match_id = m.id::text) AS scoring_locked FROM matches m WHERE season = $1 AND (is_practice IS FALSE OR is_practice IS NULL)', [season])
      ]);
      return res.status(200).json({ season, leagues: leagues.rows, teams: teams.rows, matches: games.rows });
    }
    const result = await withActiveSeason(season, async (client, activeSeason) => {
      if (req.method === 'POST') {
        if (!['preview_import', 'import_schedule'].includes(action)) throw new ScheduleError(400, 'Unknown schedule action.');
        const key = importReceiptKey(activeSeason, req.body.csvText, req.body.leagueDestinations);
        const previous = await previousImport(client, key);
        if (previous) return action === 'preview_import' ? previous : previous.summary;
        const plan = await planScheduleImport(client, activeSeason, req.body.csvText, req.body.leagueDestinations);
        if (action === 'preview_import') return { games: plan.games, summary: plan.summary };
        await executeScheduleImport(client, plan);
        await client.query('INSERT INTO app_settings (key, value) VALUES ($1, $2)', [key, JSON.stringify({ games: plan.games, summary: plan.summary })]);
        return plan.summary;
      }

      if (action === 'rename_team') {
        if (typeof id !== 'string' || typeof teamName !== 'string' || !teamName.trim() || teamName.trim().length > 100) {
          throw new ScheduleError(400, 'Enter a valid team name.');
        }
        const team = await client.query('SELECT id, league, season FROM teams WHERE id = $1 AND season = $2 FOR UPDATE', [id, season]);
        if (!team.rows.length) {
          throw new ScheduleError(404, 'Team not found in active season.');
        }
        const existing = await client.query(
          'SELECT id FROM teams WHERE season = $1 AND LOWER(TRIM(league)) = LOWER(TRIM($2)) AND LOWER(TRIM(name)) = LOWER(TRIM($3)) AND id <> $4 LIMIT 1',
          [season, team.rows[0].league, teamName.trim(), id]
        );
        if (existing.rows.length) {
          throw new ScheduleError(409, 'A team with this name already exists in that league.');
        }
        const renamed = await client.query('UPDATE teams SET name = $2 WHERE id = $1 RETURNING id, name, league, season', [id, teamName.trim()]);
        return { team: renamed.rows[0] };
      }

      if (typeof id !== 'string' || !id.trim()) {
        throw new ScheduleError(400, 'Choose a game first.');
      }
      const existing = await client.query(
        'SELECT id, season, league, status, is_complete, is_practice, revision, innings, tie_breaker FROM matches WHERE id::text = $1 AND season = $2 FOR UPDATE',
        [id, season]
      );
      if (!existing.rows.length) {
        throw new ScheduleError(404, 'Game not found in the active season.');
      }
      const game = existing.rows[0];
      await assertScheduleGamesUnlocked(client, [game]);

      if (action === 'delete_game') {
        await client.query('DELETE FROM matches WHERE id = $1 AND season = $2', [id, season]);
        return { deleted: true };
      }
      if (action !== 'update_game') {
        throw new ScheduleError(400, 'Unknown schedule action.');
      }
      if (!Number.isSafeInteger(revision) || revision !== Number(game.revision)) {
        throw new ScheduleError(409, 'This game has changed since you opened it. Refresh the schedule before editing.');
      }
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          typeof startTime !== 'string' || !startTime.trim() ||
          typeof endTime !== 'string' || !endTime.trim() ||
          typeof location !== 'string' || !canonicalCage(location) ||
          typeof notes !== 'string' || notes.length > 2000 ||
          typeof homeTeamId !== 'string' || typeof awayTeamId !== 'string' || homeTeamId === awayTeamId) {
        throw new ScheduleError(400, 'Enter a date, times, cage (5/6 or 7/8), and two different teams.');
      }
      const validationError = scheduleDateTimeError(date, startTime, endTime);
      if (validationError) {
        throw new ScheduleError(400, validationError);
      }
      const teams = await client.query(
        'SELECT id, name FROM teams WHERE id = ANY($1::text[]) AND season = $2 AND LOWER(TRIM(league)) = LOWER(TRIM($3))',
        [[homeTeamId, awayTeamId], season, game.league]
      );
      if (teams.rows.length !== 2) {
        throw new ScheduleError(400, 'Both teams must belong to this league and season.');
      }
      const bookings = await readScheduleBookings(client, season);
      const byName = new Map(teams.rows.map(row => [row.id, row.name]));
      const conflicts = findScheduleConflicts({ id, league: game.league, date, startTime, endTime, location,
        homeTeamId, awayTeamId, homeTeamName: byName.get(homeTeamId), awayTeamName: byName.get(awayTeamId) }, bookings);
      if (conflicts.length) throw new ScheduleError(409, 'This change would create a schedule conflict. No changes were saved.', conflicts);
      // Keep the inning template consistent with the selected players. Never carry
      // inning player IDs from a previous matchup into a newly assigned team.
      const oldTeams = await client.query('SELECT home_team_id, away_team_id FROM matches WHERE id = $1', [id]);
      let inningsSql = 'innings';
      let inningValue: string | null = null;
      if (oldTeams.rows[0].home_team_id !== homeTeamId || oldTeams.rows[0].away_team_id !== awayTeamId) {
        const rosters = await client.query('SELECT id, players FROM teams WHERE id = ANY($1::text[])', [[homeTeamId, awayTeamId]]);
        const byId = new Map(rosters.rows.map((row: any) => [String(row.id), typeof row.players === 'string' ? JSON.parse(row.players) : row.players]));
        const homeIds = (byId.get(homeTeamId) || []).slice(0, 3).map((player: any) => player.id);
        const awayIds = (byId.get(awayTeamId) || []).slice(0, 3).map((player: any) => player.id);
        inningValue = JSON.stringify(Array.from({ length: 6 }, (_, i) => createEmptyInning(i + 1, homeIds, awayIds)));
        inningsSql = '$9';
      }
      const updated = await client.query(
        `UPDATE matches SET revision = revision + 1, date = $2, start_time = $3, end_time = $4,
         location = $5, notes = $6, home_team_id = $7, away_team_id = $8, innings = ${inningsSql}${inningValue === null ? '' : ', is_forfeit = FALSE, forfeiting_team_id = NULL, winning_team_id = NULL, forfeit_reason = NULL'}
         WHERE id = $1 RETURNING id, revision`,
        inningValue == null
          ? [id, date + 'T12:00:00.000Z', startTime.trim(), endTime.trim(), canonicalCage(location), notes, homeTeamId, awayTeamId]
          : [id, date + 'T12:00:00.000Z', startTime.trim(), endTime.trim(), canonicalCage(location), notes, homeTeamId, awayTeamId, inningValue]
      );
      return { game: updated.rows[0] };
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof ScheduleError) return res.status(error.status).json({ error: error.message, errors: error.errors });
    console.error('[schedule-admin]', error);
    return res.status(500).json({ error: 'Could not confirm the save. Refresh before trying again; the same CSV can be retried safely.' });
  }
}
