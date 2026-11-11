import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';
import { requireRole } from './auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      const { league, season, ids } = req.query;
      let query = 'SELECT * FROM teams';
      const params: any[] = [];
      const conditions: string[] = [];
      if (ids !== undefined) {
        if (typeof ids !== 'string') return res.status(400).json({ error: 'Invalid team selection' });
        const teamIds = ids.split(',').map(id => id.trim()).filter(Boolean);
        if (!teamIds.length || teamIds.length > 2 || teamIds.some(id => id.length > 128)) {
          return res.status(400).json({ error: 'Invalid team selection' });
        }
        params.push(teamIds);
        conditions.push('id = ANY(
      }
      if (league) {
        params.push(league);
        conditions.push('LOWER(league) = LOWER(
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? '(season = 
          : 'season = );
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + '::text[])');
      }
      if (league) {
        params.push(league);
        conditions.push(`LOWER(league) = LOWER(${params.length})`);
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? `(season = ${params.length} OR season IS NULL)`
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + ')');
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? `(season = ${params.length} OR season IS NULL)`
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + '::text[])');
      }
      if (league) {
        params.push(league);
        conditions.push(`LOWER(league) = LOWER(${params.length})`);
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? `(season = ${params.length} OR season IS NULL)`
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + ' OR season IS NULL)'
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + '::text[])');
      }
      if (league) {
        params.push(league);
        conditions.push(`LOWER(league) = LOWER(${params.length})`);
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? `(season = ${params.length} OR season IS NULL)`
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + ')');
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? `(season = ${params.length} OR season IS NULL)`
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + '::text[])');
      }
      if (league) {
        params.push(league);
        conditions.push(`LOWER(league) = LOWER(${params.length})`);
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? `(season = ${params.length} OR season IS NULL)`
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + '::text[])');
      }
      if (league) {
        params.push(league);
        conditions.push(`LOWER(league) = LOWER(${params.length})`);
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? `(season = ${params.length} OR season IS NULL)`
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + ')');
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? `(season = ${params.length} OR season IS NULL)`
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + '::text[])');
      }
      if (league) {
        params.push(league);
        conditions.push(`LOWER(league) = LOWER(${params.length})`);
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? `(season = ${params.length} OR season IS NULL)`
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + ' OR season IS NULL)'
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + '::text[])');
      }
      if (league) {
        params.push(league);
        conditions.push(`LOWER(league) = LOWER(${params.length})`);
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? `(season = ${params.length} OR season IS NULL)`
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + ')');
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? `(season = ${params.length} OR season IS NULL)`
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 + params.length + '::text[])');
      }
      if (league) {
        params.push(league);
        conditions.push(`LOWER(league) = LOWER(${params.length})`);
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? `(season = ${params.length} OR season IS NULL)`
          : `season = ${params.length}`);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id, name, league, players, subs, season } = req.body || {};
      if (!name || !league || !players) return res.status(400).json({ error: 'Missing fields' });

      let teamSeason = season;
      if (!teamSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          teamSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!teamSeason) teamSeason = new Date().getFullYear().toString();

      const teamSubs = subs || [];
      const teamId = id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const query = `INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const values = [teamId, name, league, JSON.stringify(players), JSON.stringify(teamSubs), teamSeason];
      
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    }
    else if (req.method === 'PUT') {
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { id, name, players, subs } = req.body || {};
      if (!id || !name || !Array.isArray(players) || !Array.isArray(subs)) {
        return res.status(400).json({ error: 'Missing or invalid roster fields' });
      }

      if (role === 'umpire') {
        // Umpires may register substitutes during games, not rewrite the permanent roster.
        const current = await pool.query('SELECT name, players, subs FROM teams WHERE id = $1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Team not found' });
        const storedPlayers = typeof current.rows[0].players === 'string'
          ? JSON.parse(current.rows[0].players) : current.rows[0].players;
        const storedSubs = typeof current.rows[0].subs === 'string'
          ? JSON.parse(current.rows[0].subs) : (current.rows[0].subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: any) =>
          subs.some((submitted: any) => JSON.stringify(submitted) === JSON.stringify(existing))
        );
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.rows[0].name || !samePlayers || !existingSubsIntact || !uniqueSubIds) {
          return res.status(403).json({ error: 'Umpires may only add substitutes; permanent team roster changes require an admin.' });
        }
        const { rows } = await pool.query(
          'UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(subs)]
        );
        return res.status(200).json(rows[0]);
      }

      const query = `UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *`;
      const values = [id, name, JSON.stringify(players), JSON.stringify(subs || [])];
      
      const { rows } = await pool.query(query, values);
      if (rows.length === 0) return res.status(404).json({ error: 'Team not found' });
      
      return res.status(200).json(rows[0]);
    }
    else if (req.method === 'PATCH') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { action, teamIds, targetLeague } = req.body || {};

      if (action === 'move_teams') {
        if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0 || !targetLeague) {
           return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // 1. Update Teams
        const updateTeamsQuery = `
            UPDATE teams 
            SET league = $1 
            WHERE id = ANY($2)
        `;
        await pool.query(updateTeamsQuery, [targetLeague, teamIds]);

        // 2. Update Matches
        const updateMatchesQuery = `
            UPDATE matches
            SET league = $1
            WHERE home_team_id = ANY($2) OR away_team_id = ANY($2)
        `;
        await pool.query(updateMatchesQuery, [targetLeague, teamIds]);

        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }
    else if (req.method === 'DELETE') {
      const role = requireRole(req, res, ['admin']);
      if (!role) return;

      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

      // Preserve official league matches: do not allow deleting team with official matches
      const officialMatches = await pool.query(
        'SELECT id FROM matches WHERE (home_team_id = $1 OR away_team_id = $1) AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 1',
        [id]
      );
      if (officialMatches.rows.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: Cannot delete team with official league matches. Reassign or archive the team instead.'
        });
      }

      await pool.query('DELETE FROM teams WHERE id = $1', [id]);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[API] Teams Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
