
import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Ensure table exists with season column
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        league TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        players JSONB NOT NULL,
        season TEXT NOT NULL DEFAULT '2025',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- Safe migration for existing tables without 'season'
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams' AND column_name='season') THEN 
          ALTER TABLE teams ADD COLUMN season TEXT NOT NULL DEFAULT '2025'; 
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
          conditions.push(` league = $${paramCount++}`);
          params.push(league);
        }
        if (season) {
          conditions.push(` season = $${paramCount++}`);
          params.push(season);
        }
        query += conditions.join(' AND');
      }

      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const { id, name, league, players, season } = req.body;
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      // Default to 2025 if not provided, but the UI should provide it
      const teamSeason = season || '2025';

      const query = `INSERT INTO teams (id, name, league, players, season) VALUES ($1, $2, $3, $4, $5) RETURNING *`;
      const values = [id, name, league, JSON.stringify(players), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const { id, name, players } = req.body;
      if (!id || !name || !players) return res.status(400).json({ error: 'Missing fields' });
      
      const query = `UPDATE teams SET name = $2, players = $3 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players)];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
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
