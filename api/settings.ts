import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';
import { configuredLoginCredential } from '../server/passwordPolicy.js';
import { 
  comparePassword, 
  hashPassword, 
  signSessionToken, 
  setSessionCookie, 
  clearSessionCookie, 
  getAuthFromRequest, 
  requireRole 
} from './auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const defaultYear = new Date().getFullYear().toString();

    if (req.method === 'GET') {
      // Return public settings only (strictly exclude all passwords and hashes)
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
      const { action, password, season } = req.body || {};

      if (action === 'check_auth') {
        const auth = getAuthFromRequest(req);
        return res.status(200).json({ authenticated: auth.authenticated, role: auth.role });
      }

      if (action === 'logout') {
        clearSessionCookie(res);
        return res.status(200).json({ success: true, role: 'fan' });
      }

      if (action === 'login' || action === 'verify') {
        const cleanPw = (password || '').trim();
        if (!cleanPw) {
          return res.status(400).json({ success: false, error: 'Password cannot be empty' });
        }

        // 1. Fetch stored credentials
        const adminRes = await pool.query("SELECT value FROM app_settings WHERE key = 'admin_password'");
        const umpireRes = await pool.query("SELECT value FROM app_settings WHERE key = 'umpire_password'");
        
        const storedAdmin = configuredLoginCredential(adminRes.rows[0]?.value, process.env.ADMIN_PASSWORD);
        const storedUmpire = configuredLoginCredential(umpireRes.rows[0]?.value, process.env.UMPIRE_PASSWORD);

        // 2. Check Admin Password (or env override for recovery)
        const isAdminEnvMatch = process.env.ADMIN_PASSWORD && cleanPw === process.env.ADMIN_PASSWORD;
        const isAdminStoredMatch = storedAdmin ? await comparePassword(cleanPw, storedAdmin) : false;
        const isAdminMatch = !!isAdminEnvMatch || isAdminStoredMatch;

        if (isAdminMatch) {
          // Automatic upgrade from legacy plaintext to bcrypt
          if (isAdminStoredMatch && storedAdmin && !/^\$2[aby]\$\d{2}\$/.test(storedAdmin)) {
            const hashed = await hashPassword(cleanPw);
            await pool.query("UPDATE app_settings SET value = $1 WHERE key = 'admin_password'", [hashed]).catch(console.error);
          }

          const token = signSessionToken('admin');
          setSessionCookie(res, token);
          return res.status(200).json({ success: true, role: 'admin', token });
        }

        // 3. Check Umpire Password (or env override for recovery)
        const isUmpireEnvMatch = process.env.UMPIRE_PASSWORD && cleanPw === process.env.UMPIRE_PASSWORD;
        const isUmpireStoredMatch = storedUmpire ? await comparePassword(cleanPw, storedUmpire) : false;
        const isUmpireMatch = !!isUmpireEnvMatch || isUmpireStoredMatch;

        if (isUmpireMatch) {
          // Automatic upgrade from legacy plaintext to bcrypt
          if (isUmpireStoredMatch && storedUmpire && !/^\$2[aby]\$\d{2}\$/.test(storedUmpire)) {
            const hashed = await hashPassword(cleanPw);
            await pool.query("UPDATE app_settings SET value = $1 WHERE key = 'umpire_password'", [hashed]).catch(console.error);
          }

          const token = signSessionToken('umpire');
          setSessionCookie(res, token);
          return res.status(200).json({ success: true, role: 'umpire', token });
        }

        return res.status(401).json({ success: false, error: 'Incorrect password' });
      }

      if (action === 'update_password') {
        const role = requireRole(req, res, ['admin']);
        if (!role) return;

        if (!password || !password.trim()) {
          return res.status(400).json({ error: 'Password cannot be empty' });
        }
        const hashed = await hashPassword(password.trim());
        await pool.query("UPDATE app_settings SET value = $1 WHERE key = 'admin_password'", [hashed]);
        return res.status(200).json({ success: true });
      }

      if (action === 'update_umpire_password') {
        const role = requireRole(req, res, ['admin']);
        if (!role) return;

        if (!password || !password.trim()) {
          return res.status(400).json({ error: 'Password cannot be empty' });
        }
        const hashed = await hashPassword(password.trim());
        await pool.query("UPDATE app_settings SET value = $1 WHERE key = 'umpire_password'", [hashed]);
        return res.status(200).json({ success: true });
      }

      if (action === 'update_season') {
        const role = requireRole(req, res, ['admin']);
        if (!role) return;

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
