
import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Ensure table exists with season and subs columns
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        league TEXT NOT NULL,
        players JSONB NOT NULL,
        subs JSONB DEFAULT '[]',
        season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY'),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- Safe migration for existing tables without 'season'
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams' AND column_name='season') THEN 
          ALTER TABLE teams ADD COLUMN season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY'); 
        END IF; 
      END $$;

      -- Safe migration for existing tables without 'subs'
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams' AND column_name='subs') THEN 
          ALTER TABLE teams ADD COLUMN subs JSONB DEFAULT '[]'; 
        END IF; 
      END $$;
    `);

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

      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const { id, name, league, players, subs, season } = req.body;
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

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [id, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const { id, name, players, subs } = req.body;
      if (!id || !name || !players) return res.status(400).json({ error: 'Missing fields' });
      
      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const { action, teamIds, targetLeague } = req.body;

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        // We use Postgres ANY() for array checking
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        // If a team moves, their games should move with them to preserve stats for that league.
        // We update any match where EITHER the home or away team is in the moved list.
        // This ensures partial moves (if user does one team at a time) still carry stats.
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
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing ID' });
      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
