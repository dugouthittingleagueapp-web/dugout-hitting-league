import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      const { rows } = await pool.query('SELECT * FROM leagues ORDER BY id ASC');
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'League Name ID is required' });

      const query = `INSERT INTO leagues (id) VALUES ($1) ON CONFLICT (id) DO NOTHING RETURNING *`;
      const { rows } = await pool.query(query, [id]);
      return res.status(201).json(rows[0] || { id });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
