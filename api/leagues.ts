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
      
      if (!season || typeof season !== 'string') {
        return res.status(400).json({ error: 'Select a season before deleting a league.' });
      }

      // Delete unplayed schedules safely, including accidentally imported official
      // games. Once any game has started, has scores, or is finalized, retain all
      // records and require a deliberate reassignment workflow instead.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query(
          'SELECT id, status, is_complete, innings, tie_breaker FROM matches WHERE LOWER(league) = LOWER($1) AND season = $2 FOR UPDATE',
          [id, season]
        );
        const hasScores = (value: any): boolean => {
          if (!value) return false;
          let parsed = value;
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch { return true; }
          }
          const visit = (node: any): boolean => {
            if (node == null) return false;
            if (Array.isArray(node)) return node.some(visit);
            if (typeof node !== 'object') return false;
            if (typeof node.points === 'number') return true;
            if (typeof node === 'number') return true;
            return Object.entries(node).some(([key, child]) =>
              (key === 'homeScores' || key === 'awayScores') && Array.isArray(child)
                ? child.some(score => typeof score === 'number')
                : visit(child)
            );
          };
          return visit(parsed);
        };
        const protectedGame = existing.rows.find((match: any) =>
          match.is_complete === true ||
          !['SCHEDULED', null, undefined].includes(match.status) ||
          hasScores(match.innings) ||
          hasScores(match.tie_breaker)
        );
        if (protectedGame) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'This league has a game that was started or scored. Move those games to another league before deleting it. No data was deleted.'
          });
        }

        await client.query('DELETE FROM matches WHERE LOWER(league) = LOWER($1) AND season = $2', [id, season]);
        await client.query('DELETE FROM teams WHERE LOWER(league) = LOWER($1) AND season = $2', [id, season]);
        const removed = await client.query('DELETE FROM leagues WHERE LOWER(id) = LOWER($1) AND season = $2 RETURNING id', [id, season]);
        if (!removed.rowCount) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'League not found for this season. Nothing was deleted.' });
        }
        await client.query('COMMIT');
        return res.status(200).json({ success: true, deletedGames: existing.rows.length });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    }
    
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Error in api/leagues:", error);
    return res.status(500).json({ error: `DB Error: ${error.message}` });
  }
}