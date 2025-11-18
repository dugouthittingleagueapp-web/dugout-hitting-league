import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        league TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        players JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    if (req.method === 'GET') {
      const { league } = req.query;
      let query = 'SELECT * FROM teams';
      const params: any[] = [];

      if (league) {
        query += ' WHERE league = $1';
        params.push(league);
      }

      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const { id, name, league, players } = req.body;
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      const query = `INSERT INTO teams (id, name, league, players) VALUES ($1, $2, $3, $4) RETURNING *`;
      const values = [id, name, league, JSON.stringify(players)];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
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