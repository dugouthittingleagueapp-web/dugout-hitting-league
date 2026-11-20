import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';
import { requireRole } from './auth.js';
import { withActiveSeason, ScheduleError, assertScheduleGamesUnlocked } from '../server/scheduleTransaction.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      const { season } = req.query;
      const result = typeof season === 'string'
        ? await pool.query('SELECT * FROM leagues WHERE season = $1 OR season IS NULL ORDER BY id ASC', [season])
        : await pool.query('SELECT * FROM leagues ORDER BY id ASC');
      return res.status(200).json(result.rows);
    }
    if (!['POST', 'DELETE'].includes(req.method || '')) return res.status(405).json({ error: 'Method not allowed' });
    if (!requireRole(req, res, ['admin'])) return;
    const { id, season } = req.method === 'POST' ? req.body || {} : req.query;
    if (typeof id !== 'string' || !id.trim() || id.trim().length > 100)
      return res.status(400).json({ error: 'Enter a league name of 1–100 characters.' });
    if (req.method === 'DELETE' && typeof season !== 'string') return res.status(400).json({ error: 'Select a season first.' });
    const result = await withActiveSeason(season, async (client, active) => {
      const found = await client.query('SELECT id, season FROM leagues WHERE LOWER(TRIM(id)) = LOWER(TRIM($1)) AND season = $2 FOR UPDATE', [id, active]);
      if (found.rows.length > 1) throw new ScheduleError(409, 'More than one league has this name. Ask an admin to review it.');
      if (req.method === 'POST') {
        if (found.rows[0]) return found.rows[0];
        return (await client.query('INSERT INTO leagues (id, season) VALUES ($1, $2) RETURNING *', [id.trim(), active])).rows[0];
      }
      if (!found.rows[0]) throw new ScheduleError(404, 'League not found. Nothing was removed.');
      const canonical = found.rows[0].id;
      const games = await client.query('SELECT id, status, is_complete, innings, tie_breaker FROM matches WHERE LOWER(TRIM(league)) = LOWER(TRIM($1)) AND season = $2 FOR UPDATE', [canonical, active]);
      await assertScheduleGamesUnlocked(client, games.rows);
      await client.query('DELETE FROM matches WHERE LOWER(TRIM(league)) = LOWER(TRIM($1)) AND season = $2', [canonical, active]);
      await client.query('DELETE FROM teams WHERE LOWER(TRIM(league)) = LOWER(TRIM($1)) AND season = $2', [canonical, active]);
      await client.query('DELETE FROM leagues WHERE id = $1 AND season = $2', [canonical, active]);
      return { success: true, deletedGames: games.rows.length };
    });
    return res.status(req.method === 'POST' ? 201 : 200).json(result);
  } catch (error) {
    if (error instanceof ScheduleError) return res.status(error.status).json({ error: error.message });
    console.error('[leagues]', error);
    return res.status(500).json({ error: 'No changes were saved. Refresh and try again.' });
  }
}
