
import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 1. Ensure table exists with composite (id, season) key
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leagues (
        id TEXT NOT NULL,
        season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY'),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (id, season)
      );
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leagues' AND column_name='season') THEN
          ALTER TABLE leagues ADD COLUMN season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY');
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE table_name = 'leagues' AND constraint_type = 'PRIMARY KEY'
        ) THEN
          IF (SELECT count(*) FROM information_schema.key_column_usage WHERE table_name = 'leagues') = 1 THEN
            ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_league_fkey;
            ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_league_fkey;
            ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_pkey;
            ALTER TABLE leagues ADD PRIMARY KEY (id, season);
          END IF;
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
      const { id, season } = req.body;
      
      if (!id || typeof id !== 'string' || !id.trim()) {
        return res.status(400).json({ error: 'League Name ID is required and cannot be empty' });
      }

      const cleanId = id.trim();
      let targetSeason = season;
      if (!targetSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          targetSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!targetSeason) targetSeason = new Date().getFullYear().toString();

      // Upsert on composite (id, season)
      const query = `
        INSERT INTO leagues (id, season) VALUES ($1, $2) 
        ON CONFLICT (id, season) DO UPDATE SET id = EXCLUDED.id 
        RETURNING *
      `;
      
      const { rows } = await pool.query(query, [cleanId, targetSeason]);
      
      if (!rows || rows.length === 0) {
        throw new Error("Database executed query but returned no rows.");
      }
      
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'DELETE') {
      const { id, season } = req.query;
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'League ID is required' });
      }
      
      if (season && typeof season === 'string') {
        await pool.query('DELETE FROM matches WHERE league = $1 AND season = $2', [id, season]);
        await pool.query('DELETE FROM teams WHERE league = $1 AND season = $2', [id, season]);
        await pool.query('DELETE FROM leagues WHERE id = $1 AND season = $2', [id, season]);
      } else {
        await pool.query('DELETE FROM matches WHERE league = $1', [id]);
        await pool.query('DELETE FROM teams WHERE league = $1', [id]);
        await pool.query('DELETE FROM leagues WHERE id = $1', [id]);
      }
      return res.status(200).json({ success: true });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Detailed DB Error in api/leagues:", error);
    // Return the actual error message to the UI for easier debugging
    return res.status(500).json({ error: `DB Error: ${error.message}` });
  }
}