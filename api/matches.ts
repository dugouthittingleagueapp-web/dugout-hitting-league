import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id UUID PRIMARY KEY,
        league TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        home_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
        away_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
        date TIMESTAMPTZ NOT NULL,
        is_complete BOOLEAN DEFAULT FALSE,
        innings JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    if (req.method === 'GET') {
      const { league, id } = req.query;
      if (id) {
        const { rows } = await pool.query('SELECT * FROM matches WHERE id = $1', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(rows[0]);
      }
      let query = 'SELECT * FROM matches';
      const params: any[] = [];
      if (league) {
        query += ' WHERE league = $1';
        params.push(league);
      }
      query += ' ORDER BY date DESC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const { id, league, homeTeamId, awayTeamId, date, isComplete, innings } = req.body;
      const query = `INSERT INTO matches (id, league, home_team_id, away_team_id, date, is_complete, innings) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`;
      const values = [id, league, homeTeamId, awayTeamId, date, isComplete, JSON.stringify(innings)];
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    } 
    else if (req.method === 'PUT') {
      const { id, isComplete, innings } = req.body;
      const query = `UPDATE matches SET is_complete = $2, innings = $3 WHERE id = $1 RETURNING *`;
      const values = [id, isComplete, JSON.stringify(innings)];
      const { rows } = await pool.query(query, values);
      return res.status(200).json(rows[0]);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}