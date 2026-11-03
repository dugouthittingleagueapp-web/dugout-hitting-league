
import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 1. Ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // 2. Ensure default values exist (executed as separate sequential queries)
    // Admin default: 'admin'
    // Umpire default: 'umpire'
    const defaultYear = new Date().getFullYear().toString();
    await pool.query(
      "INSERT INTO app_settings (key, value) VALUES ('admin_password', 'admin') ON CONFLICT (key) DO NOTHING"
    );
    await pool.query(
      "INSERT INTO app_settings (key, value) VALUES ('umpire_password', 'umpire') ON CONFLICT (key) DO NOTHING"
    );
    await pool.query(
      "INSERT INTO app_settings (key, value) VALUES ('current_season', $1) ON CONFLICT (key) DO NOTHING",
      [defaultYear]
    );

    if (req.method === 'GET') {
        // Return all public settings (exclude passwords)
        const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
        const currentSeason = rows[0]?.value || defaultYear;

        let seasons: string[] = [currentSeason, '2025'];
        try {
          const seasonsRes = await pool.query(`
            SELECT DISTINCT season FROM (
              SELECT season FROM leagues WHERE season IS NOT NULL
              UNION
              SELECT season FROM teams WHERE season IS NOT NULL
              UNION
              SELECT season FROM matches WHERE season IS NOT NULL
              UNION
              SELECT '2025' AS season
              UNION
              SELECT '2026' AS season
              UNION
              SELECT $1 AS season
            ) s WHERE season != '' ORDER BY season DESC
          `, [currentSeason]);
          if (seasonsRes.rows.length > 0) {
            seasons = seasonsRes.rows.map(r => r.season);
          }
        } catch (e) {
          // Fallback if schema is legacy
        }

        const uniqueSeasons = Array.from(new Set([...seasons, '2026', '2025', currentSeason])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        return res.status(200).json({ currentSeason, seasons: uniqueSeasons });
    }
    else if (req.method === 'POST') {
      const { action, password, season } = req.body;

      if (action === 'verify') {
        const adminRes = await pool.query("SELECT value FROM app_settings WHERE key = 'admin_password'");
        const umpireRes = await pool.query("SELECT value FROM app_settings WHERE key = 'umpire_password'");
        
        const storedAdmin = (adminRes.rows[0]?.value || 'admin').trim();
        const storedUmpire = (umpireRes.rows[0]?.value || 'umpire').trim();
        const cleanPw = (password || '').trim();
        
        if (cleanPw.toLowerCase() === storedAdmin.toLowerCase()) {
          return res.status(200).json({ success: true, role: 'admin' });
        }
        if (cleanPw.toLowerCase() === storedUmpire.toLowerCase()) {
          return res.status(200).json({ success: true, role: 'umpire' });
        }
        
        return res.status(401).json({ success: false, error: 'Incorrect password' });
      }

      if (action === 'update_password') {
        // Updates Admin Password
        if (!password || !password.trim()) {
          return res.status(400).json({ error: 'Password cannot be empty' });
        }
        await pool.query("UPDATE app_settings SET value = $1 WHERE key = 'admin_password'", [password.trim()]);
        return res.status(200).json({ success: true });
      }

      if (action === 'update_umpire_password') {
        // Updates Umpire Password
        if (!password || !password.trim()) {
          return res.status(400).json({ error: 'Password cannot be empty' });
        }
        await pool.query("UPDATE app_settings SET value = $1 WHERE key = 'umpire_password'", [password.trim()]);
        return res.status(200).json({ success: true });
      }

      if (action === 'update_season') {
        if (!season || !season.trim()) {
            return res.status(400).json({ error: 'Season cannot be empty' });
        }
        const newSeason = season.trim();
        const curRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
        const prevSeason = curRes.rows[0]?.value || defaultYear;

        await pool.query("UPDATE app_settings SET value = $1 WHERE key = 'current_season'", [newSeason]);

        // Rollover leagues from previous season to new season if new season has no leagues
        try {
          const newLeagues = await pool.query("SELECT id FROM leagues WHERE season = $1", [newSeason]);
          if (newLeagues.rows.length === 0) {
            const prevLeagues = await pool.query("SELECT DISTINCT id FROM leagues WHERE season = $1", [prevSeason]);
            const sourceRows = prevLeagues.rows.length > 0 ? prevLeagues.rows : (await pool.query("SELECT DISTINCT id FROM leagues")).rows;
            for (const row of sourceRows) {
              await pool.query("INSERT INTO leagues (id, season) VALUES ($1, $2) ON CONFLICT DO NOTHING", [row.id, newSeason]);
            }
          }
        } catch (e) {
          // Season column might not exist if legacy table, ignore gracefully
        }

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Settings Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
