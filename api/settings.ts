
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

    // 2. Ensure default values exist
    // Admin default: 'admin'
    // Umpire default: 'umpire'
    await pool.query(`
      INSERT INTO app_settings (key, value) VALUES ('admin_password', 'admin') ON CONFLICT (key) DO NOTHING;
      INSERT INTO app_settings (key, value) VALUES ('umpire_password', 'umpire') ON CONFLICT (key) DO NOTHING;
      INSERT INTO app_settings (key, value) VALUES ('current_season', '2025') ON CONFLICT (key) DO NOTHING;
    `);

    if (req.method === 'GET') {
        // Return all public settings (exclude passwords)
        const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
        const currentSeason = rows[0]?.value || '2025';
        return res.status(200).json({ currentSeason });
    }
    else if (req.method === 'POST') {
      const { action, password, season } = req.body;

      if (action === 'verify') {
        const adminRes = await pool.query("SELECT value FROM app_settings WHERE key = 'admin_password'");
        const umpireRes = await pool.query("SELECT value FROM app_settings WHERE key = 'umpire_password'");
        
        const storedAdmin = adminRes.rows[0]?.value;
        const storedUmpire = umpireRes.rows[0]?.value;
        
        if (password === storedAdmin) {
          return res.status(200).json({ success: true, role: 'admin' });
        }
        if (password === storedUmpire) {
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
        await pool.query("UPDATE app_settings SET value = $1 WHERE key = 'current_season'", [season.trim()]);
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