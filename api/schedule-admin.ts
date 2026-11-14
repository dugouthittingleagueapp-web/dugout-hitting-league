import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';
import { requireRole } from './auth.js';

// Admin-only calendar maintenance. Do not route this through the normal scoring
// PUT endpoint: a schedule correction must not rewrite inning/pitch histories.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const role = requireRole(req, res, ['admin']);
  if (!role) return;
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const { action, season, id, revision, date, startTime, endTime, location, notes,
    homeTeamId, awayTeamId, teamName } = req.body || {};
  if (typeof season !== 'string' || !/^\d{4}$/.test(season))
    return res.status(400).json({ error: 'Select a valid season.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const active = await client.query("SELECT value FROM app_settings WHERE key = 'current_season'");
    if (season !== active.rows[0]?.value) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the current active season can be edited. Older schedules are preserved.' });
    }

    if (action === 'rename_team') {
      if (typeof id !== 'string' || typeof teamName !== 'string' || !teamName.trim() || teamName.trim().length > 100) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Enter a valid team name.' });
      }
      const team = await client.query('SELECT id, league, season FROM teams WHERE id = $1 AND season = $2 FOR UPDATE', [id, season]);
      if (!team.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Team not found in active season.' });
      }
      const existing = await client.query(
        'SELECT id FROM teams WHERE season = $1 AND LOWER(TRIM(league)) = LOWER(TRIM($2)) AND LOWER(TRIM(name)) = LOWER(TRIM($3)) AND id <> $4 LIMIT 1',
        [season, team.rows[0].league, teamName.trim(), id]
      );
      if (existing.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'A team with this name already exists in that league.' });
      }
      const renamed = await client.query('UPDATE teams SET name = $2 WHERE id = $1 RETURNING id, name, league, season', [id, teamName.trim()]);
      await client.query('COMMIT');
      return res.status(200).json({ team: renamed.rows[0] });
    }

    if (typeof id !== 'string' || !id.trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Choose a game first.' });
    }
    const existing = await client.query(
      'SELECT id, season, league, status, is_complete, is_practice, revision, innings, tie_breaker FROM matches WHERE id::text = $1 AND season = $2 FOR UPDATE',
      [id, season]
    );
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Game not found in the active season.' });
    }
    const game = existing.rows[0];
    const hasScores = (value: any): boolean => {
      if (!value) return false;
      let parsed = value;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { return true; }
      }
      const walk = (node: any): boolean => {
        if (node == null) return false;
        if (Array.isArray(node)) return node.some(walk);
        if (typeof node !== 'object') return false;
        if (typeof node.points === 'number') return true;
        return Object.entries(node).some(([key, val]) =>
          ['homeScores', 'awayScores'].includes(key) && Array.isArray(val)
            ? val.some(score => typeof score === 'number')
            : walk(val)
        );
      };
      return walk(parsed);
    };
    if (game.is_complete || game.status !== 'SCHEDULED' || hasScores(game.innings) || hasScores(game.tie_breaker)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This game has started or has scores. Its schedule is locked to protect recorded results.' });
    }

    if (action === 'delete_game') {
      await client.query('DELETE FROM matches WHERE id = $1 AND season = $2', [id, season]);
      await client.query('COMMIT');
      return res.status(200).json({ deleted: true });
    }
    if (action !== 'update_game') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Unknown schedule action.' });
    }
    if (!Number.isSafeInteger(revision) || revision !== Number(game.revision)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This game has changed since you opened it. Refresh the schedule before editing.' });
    }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(Date.parse(date + 'T12:00:00Z')) ||
        typeof startTime !== 'string' || !startTime.trim() ||
        typeof endTime !== 'string' || !endTime.trim() ||
        typeof location !== 'string' || !location.trim() || location.length > 200 ||
        typeof notes !== 'string' || notes.length > 2000 ||
        typeof homeTeamId !== 'string' || typeof awayTeamId !== 'string' || homeTeamId === awayTeamId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Enter a date, times, location, and two different teams.' });
    }
    const teams = await client.query(
      'SELECT id FROM teams WHERE id = ANY($1::text[]) AND season = $2 AND LOWER(TRIM(league)) = LOWER(TRIM($3))',
      [[homeTeamId, awayTeamId], season, game.league]
    );
    if (teams.rows.length !== 2) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Both teams must belong to this league and season.' });
    }
    // Keep the inning template consistent with the selected players. Never carry
    // inning player IDs from a previous matchup into a newly assigned team.
    const oldTeams = await client.query('SELECT home_team_id, away_team_id FROM matches WHERE id = $1', [id]);
    let inningsSql = 'innings';
    let inningValue: string | null = null;
    if (oldTeams.rows[0].home_team_id !== homeTeamId || oldTeams.rows[0].away_team_id !== awayTeamId) {
      const rosters = await client.query('SELECT id, players FROM teams WHERE id = ANY($1::text[])', [[homeTeamId, awayTeamId]]);
      const byId = new Map(rosters.rows.map((row: any) => [String(row.id), typeof row.players === 'string' ? JSON.parse(row.players) : row.players]));
      const makeSide = (teamId: string) => ({
        teamId,
        playerScores: (byId.get(teamId) || []).slice(0, 3).map((player: any) => ({
          playerId: player.id,
          pitches: Array.from({ length: 10 }, () => ({ points: null }))
        }))
      });
      inningValue = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({
        number: i + 1,
        home: makeSide(homeTeamId),
        away: makeSide(awayTeamId)
      })));
      inningsSql = '$9';
    }
    const updated = await client.query(
      `UPDATE matches SET revision = revision + 1, date = $2, start_time = $3, end_time = $4,
       location = $5, notes = $6, home_team_id = $7, away_team_id = $8, innings = ${inningsSql}
       WHERE id = $1 RETURNING id, revision`,
      inningValue == null
        ? [id, date + 'T12:00:00.000Z', startTime.trim(), endTime.trim(), location.trim(), notes, homeTeamId, awayTeamId]
        : [id, date + 'T12:00:00.000Z', startTime.trim(), endTime.trim(), location.trim(), notes, homeTeamId, awayTeamId, inningValue]
    );
    await client.query('COMMIT');
    return res.status(200).json({ game: updated.rows[0] });
  } catch (error: any) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[schedule-admin]', error);
    return res.status(500).json({ error: 'Could not save schedule changes. Please try again.' });
  } finally {
    client.release();
  }
}
