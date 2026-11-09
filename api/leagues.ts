import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';
import { requireRole } from './auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      const { season } = req.query;
      if (season && typeof season === 'string') {
        const { rows } = await pool.query(
          'SELECT * FROM leagues WHERE season = $1 OR season IS NULL ORDER BY id ASC',
          [season]
        );
        return res.status(200).json(rows);
      }
      const { rows } = await pool.query('SELECT * FROM leagues ORDER BY id ASC');
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      // Server-side authorization check: Only ADMIN can manage/create leagues
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, season } = req.body || {};
      
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
      // Server-side authorization check: Only ADMIN can delete leagues
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, season } = req.query;
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'League ID is required' });
      }
      
      // Preserve official matches: protect any league with existing official matches from deletion
      const officialCheck = season && typeof season === 'string'
        ? await pool.query('SELECT id FROM matches WHERE league = $1 AND season = $2 AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1', [id, season])
        : await pool.query('SELECT id FROM matches WHERE league = $1 AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1', [id]);

      if (officialCheck.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete league containing official league matches. Move or reassign matches first.'
        });
      }

      if (season && typeof season === 'string') {
        await pool.query('DELETE FROM matches WHERE league = $1 AND season = $2 AND is_practice IS TRUE', [id, season]);
        await pool.query('DELETE FROM teams WHERE league = $1 AND season = $2', [id, season]);
        await pool.query('DELETE FROM leagues WHERE id = $1 AND season = $2', [id, season]);
      } else {
        await pool.query('DELETE FROM matches WHERE league = $1 AND is_practice IS TRUE', [id]);
        await pool.query('DELETE FROM teams WHERE league = $1', [id]);
        await pool.query('DELETE FROM leagues WHERE id = $1', [id]);
      }
      return res.status(200).json({ success: true });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Error in api/leagues:", error);
    return res.status(500).json({ error: `DB Error: ${error.message}` });
  }
}