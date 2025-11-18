import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`League API accessed: ${req.method}`);
  
  try {
    // Ensure table exists (Lazy migration)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leagues (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    if (req.method === 'GET') {
      const { rows } = await pool.query('SELECT * FROM leagues ORDER BY id ASC');
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const { id } = req.body;
      console.log(`Attempting to create league: ${id}`);
      
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'League Name ID is required' });
      }

      const query = `INSERT INTO leagues (id) VALUES ($1) ON CONFLICT (id) DO NOTHING RETURNING *`;
      const { rows } = await pool.query(query, [id]);
      
      console.log(`League creation result: ${JSON.stringify(rows[0])}`);
      
      return res.status(201).json(rows[0] || { id, created_at: new Date().toISOString() });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("Detailed DB Error in api/leagues:", error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}