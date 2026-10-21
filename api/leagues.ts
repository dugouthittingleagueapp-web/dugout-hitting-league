
import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 1. Ensure table exists (Lazy migration with season column)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leagues (
        id TEXT PRIMARY KEY,
        season TEXT DEFAULT '2026',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leagues' AND column_name='season') THEN
          ALTER TABLE leagues ADD COLUMN season TEXT DEFAULT '2026';
        END IF;
      END $$;
    `);

    if (req.method === 'GET') {
      const { season } = req.query;
      if (season && typeof season === 'string') {
        const { rows } = await pool.query('SELECT * FROM leagues WHERE season = $1 OR season IS NULL ORDER BY id ASC', [season]);
        return res.status(200).json(rows);
      }
      const { rows } = await pool.query('SELECT * FROM leagues ORDER BY id ASC');
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const { id, season = '2026' } = req.body;
      
      if (!id || typeof id !== 'string' || !id.trim()) {
        return res.status(400).json({ error: 'League Name ID is required and cannot be empty' });
      }

      const cleanId = id.trim();

      // Use UPSERT (Do Update) to ensure RETURNING * always returns a row, even if it exists
      const query = `
        INSERT INTO leagues (id, season) VALUES ($1, $2) 
        ON CONFLICT (id) DO UPDATE SET season = EXCLUDED.season 
        RETURNING *
      `;
      
      const { rows } = await pool.query(query, [cleanId, season]);
      
      if (!rows || rows.length === 0) {
        throw new Error("Database executed query but returned no rows.");
      }
      
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'League ID is required' });
      }
      
      // Due to ON DELETE CASCADE in teams/matches, this will wipe data for that league
      await pool.query('DELETE FROM leagues WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Detailed DB Error in api/leagues:", error);
    // Return the actual error message to the UI for easier debugging
    return res.status(500).json({ error: `DB Error: ${error.message}` });
  }
}