
import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Ensure table exists with season
    await pool.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id UUID PRIMARY KEY,
        league TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        home_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
        away_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
        date TIMESTAMPTZ NOT NULL,
        is_complete BOOLEAN DEFAULT FALSE,
        innings JSONB NOT NULL,
        season TEXT NOT NULL DEFAULT '2025',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Safe migration for existing tables without 'season'
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='season') THEN 
          ALTER TABLE matches ADD COLUMN season TEXT NOT NULL DEFAULT '2025'; 
        END IF; 
      END $$;
    `);

    if (req.method === 'GET') {
      const { league, id, season } = req.query;
      if (id) {
        const { rows } = await pool.query('SELECT * FROM matches WHERE id = $1', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(rows[0]);
      }

      let query = 'SELECT * FROM matches';
      const params: any[] = [];
      let paramCount = 1;
      
      // Build dynamic where clause
      const conditions = [];
      if (league) {
        conditions.push(`league = $${paramCount++}`);
        params.push(league);
      }
      if (season) {
        conditions.push(`season = $${paramCount++}`);
        params.push(season);
      }
      
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY date DESC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const { id, league, homeTeamId, awayTeamId, date, isComplete, innings, season } = req.body;
      
      const matchSeason = season || '2026';

      const query = `INSERT INTO matches (id, league, home_team_id, away_team_id, date, is_complete, innings, season) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`;
      const values = [id, league, homeTeamId, awayTeamId, date, isComplete, JSON.stringify(innings), matchSeason];
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    } 
    else if (req.method === 'PUT') {
      // We accept tieBreaker via the 'innings' field (merged in FE) or if passed as a prop we merge it here
      const { id, isComplete, innings, tieBreaker, league } = req.body;
      
      // We need to ensure the column exists
      await pool.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='tie_breaker') THEN 
            ALTER TABLE matches ADD COLUMN tie_breaker JSONB; 
          END IF; 
        END $$;
      `);
      
      // Updated query to allow changing league (COALESCE keeps existing if undefined)
      const queryUpdate = `
        UPDATE matches 
        SET is_complete = $2, innings = $3, tie_breaker = $4, league = COALESCE($5, league) 
        WHERE id = $1 
        RETURNING *
      `;
      const values = [id, isComplete, JSON.stringify(innings), tieBreaker ? JSON.stringify(tieBreaker) : null, league];

      const { rows } = await pool.query(queryUpdate, values);
      
      // Map back for response
      const row = rows[0];
      if(row) {
          row.innings = typeof row.innings === 'string' ? JSON.parse(row.innings) : row.innings;
          if(row.tie_breaker) row.tieBreaker = typeof row.tie_breaker === 'string' ? JSON.parse(row.tie_breaker) : row.tie_breaker;
      }
      
      return res.status(200).json(row);
    }
    else if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing ID' });
      
      // Simple delete logic
      await pool.query('DELETE FROM matches WHERE id = $1', [id]);
      
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
