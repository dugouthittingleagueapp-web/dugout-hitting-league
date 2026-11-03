
import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 1. Ensure table exists with all standard columns
    await pool.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id UUID PRIMARY KEY,
        league TEXT NOT NULL,
        home_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
        away_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
        date TIMESTAMPTZ NOT NULL,
        is_complete BOOLEAN DEFAULT FALSE,
        innings JSONB NOT NULL,
        season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY'),
        location TEXT,
        start_time TEXT,
        end_time TEXT,
        notes TEXT,
        status TEXT DEFAULT 'SCHEDULED',
        is_practice BOOLEAN DEFAULT FALSE,
        tie_breaker JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 2. Safe independent migrations for existing tables
    await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY')`);
    await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS location TEXT`);
    await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS start_time TEXT`);
    await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS end_time TEXT`);
    await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS notes TEXT`);
    await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'SCHEDULED'`);
    await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_practice BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS tie_breaker JSONB`);

    if (req.method === 'GET') {
      const { league, id, season } = req.query;
      if (id) {
        const { rows } = await pool.query('SELECT * FROM matches WHERE id = $1', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(rows[0]);
      }

      let query = 'SELECT * FROM matches';
      const params: any[] = [];
      let paramCount = 1;
      
      // Build dynamic where clause
      const conditions = [];
      if (league) {
        conditions.push(`LOWER(league) = LOWER($${paramCount++})`);
        params.push(league);
      }
      if (season) {
        if (season === '2025') {
          conditions.push(`(season = $${paramCount++} OR season IS NULL)`);
          params.push(season);
        } else {
          conditions.push(`season = $${paramCount++}`);
          params.push(season);
        }
      }
      
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY date DESC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const { id, league, homeTeamId, awayTeamId, date, isComplete, innings, season, location, startTime, endTime, notes, status, isPractice, is_practice } = req.body;
      
      let matchSeason = season;
      if (!matchSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          matchSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!matchSeason) matchSeason = new Date().getFullYear().toString();

      const matchStatus = status || (isComplete ? 'FINAL' : 'SCHEDULED');
      const matchIsPractice = isPractice ?? is_practice ?? false;

      const query = `
        INSERT INTO matches (id, league, home_team_id, away_team_id, date, is_complete, innings, season, location, start_time, end_time, notes, status, is_practice) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
        RETURNING *
      `;
      const values = [
        id, 
        league, 
        homeTeamId, 
        awayTeamId, 
        date, 
        isComplete ?? false, 
        JSON.stringify(innings), 
        matchSeason,
        location || null,
        startTime || null,
        endTime || null,
        notes || null,
        matchStatus,
        matchIsPractice
      ];
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    } 
    else if (req.method === 'PUT') {
      // We accept tieBreaker via the 'innings' field (merged in FE) or if passed as a prop we merge it here
      const { id, isComplete, innings, tieBreaker, league, location, startTime, endTime, notes, homeTeamId, awayTeamId, status, isPractice, is_practice } = req.body;
      
      // Ensure tie_breaker column exists
      await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS tie_breaker JSONB`);
      
      const practiceFlag = isPractice !== undefined ? isPractice : (is_practice !== undefined ? is_practice : null);

      // Updated query to allow changing league and schedule fields, swapping teams, status, and is_practice
      const queryUpdate = `
        UPDATE matches 
        SET is_complete = COALESCE($2, is_complete), 
            innings = COALESCE($3, innings), 
            tie_breaker = $4, 
            league = COALESCE($5, league),
            location = COALESCE($6, location),
            start_time = COALESCE($7, start_time),
            end_time = COALESCE($8, end_time),
            notes = COALESCE($9, notes),
            home_team_id = COALESCE($10, home_team_id),
            away_team_id = COALESCE($11, away_team_id),
            status = COALESCE($12, status),
            is_practice = COALESCE($13, is_practice)
        WHERE id = $1 
        RETURNING *
      `;
      const values = [
        id, 
        isComplete !== undefined ? isComplete : null, 
        innings ? JSON.stringify(innings) : null, 
        tieBreaker ? JSON.stringify(tieBreaker) : null, 
        league !== undefined ? league : null,
        location !== undefined ? location : null,
        startTime !== undefined ? startTime : null,
        endTime !== undefined ? endTime : null,
        notes !== undefined ? notes : null,
        homeTeamId !== undefined ? homeTeamId : null,
        awayTeamId !== undefined ? awayTeamId : null,
        status !== undefined ? status : (isComplete ? 'FINAL' : null),
        practiceFlag
      ];

      const { rows } = await pool.query(queryUpdate, values);
      
      // Map back for response
      const row = rows[0];
      if(row) {
          row.innings = typeof row.innings === 'string' ? JSON.parse(row.innings) : row.innings;
          if(row.tie_breaker) row.tieBreaker = typeof row.tie_breaker === 'string' ? JSON.parse(row.tie_breaker) : row.tie_breaker;
      }
      
      return res.status(200).json(row);
    }
    else if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing ID' });
      
      // Simple delete logic
      await pool.query('DELETE FROM matches WHERE id = $1', [id]);
      
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
