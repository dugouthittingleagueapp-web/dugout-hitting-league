import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';
import { requireRole } from './auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      const { league, season } = req.query;
      let query = 'SELECT * FROM teams';
      const params: any[] = [];
      let paramCount = 1;

      if (league || season) {
        query += ' WHERE';
        const conditions = [];
        if (league) {
          conditions.push(` LOWER(league) = LOWER($${paramCount++})`);
          params.push(league);
        }
        if (season) {
          if (season === '2025') {
            conditions.push(` (season = $${paramCount++} OR season IS NULL)`);
            params.push(season);
          } else {
            conditions.push(` season = $${paramCount++}`);
            params.push(season);
          }
        }
        query += conditions.join(' AND');
      }

      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !players) return res.status(400).json({ error: 'Missing fields' });
      
      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
