import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanMatchId(id: any): { rawId: string; strippedId: string; isPracticePrefix: boolean; isStrippedUuid: boolean } {
  const rawId = String(id || '').trim();
  const isPracticePrefix = rawId.startsWith('practice-');
  const strippedId = isPracticePrefix ? rawId.slice('practice-'.length).trim() : rawId;
  const isStrippedUuid = UUID_REGEX.test(strippedId);
  return { rawId, strippedId, isPracticePrefix, isStrippedUuid };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 1. Ensure table exists with all standard columns (using TEXT for IDs to safely support practice & external sessions)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        league TEXT NOT NULL,
        home_team_id TEXT,
        away_team_id TEXT,
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
    try {
      await pool.query(`ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_home_team_id_fkey`);
      await pool.query(`ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_away_team_id_fkey`);
    } catch (e) {}
    try {
      await pool.query(`ALTER TABLE matches ALTER COLUMN id TYPE TEXT`);
    } catch (e) {}
    try {
      await pool.query(`ALTER TABLE matches ALTER COLUMN home_team_id DROP NOT NULL`);
      await pool.query(`ALTER TABLE matches ALTER COLUMN away_team_id DROP NOT NULL`);
      await pool.query(`ALTER TABLE matches ALTER COLUMN home_team_id TYPE TEXT`);
      await pool.query(`ALTER TABLE matches ALTER COLUMN away_team_id TYPE TEXT`);
    } catch (e) {}
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
        const { rawId, strippedId } = cleanMatchId(id);
        const { rows } = await pool.query(
          'SELECT * FROM matches WHERE id::text = $1 OR id::text = $2 LIMIT 1',
          [rawId, strippedId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const row = rows[0];
        if (row.innings && typeof row.innings === 'string') row.innings = JSON.parse(row.innings);
        if (row.tie_breaker && typeof row.tie_breaker === 'string') row.tieBreaker = JSON.parse(row.tie_breaker);
        if (rawId.startsWith('practice-') && !String(row.id).startsWith('practice-')) {
          row.id = rawId;
        }
        return res.status(200).json(row);
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
      if (req.query.includePractice !== 'true') {
        conditions.push(`(is_practice IS FALSE OR is_practice IS NULL)`);
      }
      
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY date ASC, start_time ASC, id ASC';
      const { rows } = await pool.query(query, params);
      const mappedRows = rows.map(row => {
        if (row.innings && typeof row.innings === 'string') row.innings = JSON.parse(row.innings);
        if (row.tie_breaker && typeof row.tie_breaker === 'string') row.tieBreaker = JSON.parse(row.tie_breaker);
        if (row.is_practice && !String(row.id).startsWith('practice-')) {
          row.id = `practice-${row.id}`;
        }
        return row;
      });

      // Ensure strict chronological ascending order: date ASC, start_time ASC
      const parseTimeToMinutes = (timeStr?: string | null, dateStr?: string | null): number => {
        if (timeStr && typeof timeStr === 'string' && timeStr.trim().length > 0) {
          const clean = timeStr.trim().toLowerCase();
          const isPM = clean.includes('pm') || clean.includes('p.m.');
          const isAM = clean.includes('am') || clean.includes('a.m.');
          const numbersOnly = clean.replace(/[^\d:]/g, '');
          const [hStr, mStr] = numbersOnly.split(':');
          let hours = parseInt(hStr || '0', 10);
          const minutes = parseInt(mStr || '0', 10);
          if (isPM && hours < 12) hours += 12;
          else if (isAM && hours === 12) hours = 0;
          return hours * 60 + minutes;
        }
        if (dateStr && typeof dateStr === 'string' && dateStr.includes('T')) {
          const timeMatch = dateStr.match(/T(\d{2}):(\d{2})/);
          if (timeMatch) {
            return parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
          }
        }
        return 18 * 60;
      };

      mappedRows.sort((a, b) => {
        const dateA = String(a.date || '').slice(0, 10);
        const dateB = String(b.date || '').slice(0, 10);
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        const timeA = parseTimeToMinutes(a.start_time || a.startTime, a.date);
        const timeB = parseTimeToMinutes(b.start_time || b.startTime, b.date);
        if (timeA !== timeB) return timeA - timeB;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });

      return res.status(200).json(mappedRows);
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

      const { rawId, strippedId, isPracticePrefix, isStrippedUuid } = cleanMatchId(id);
      // Strip 'practice-' prefix to a clean UUID for database storage if needed
      const insertId = isPracticePrefix && isStrippedUuid ? strippedId : rawId;

      const query = `
        INSERT INTO matches (id, league, home_team_id, away_team_id, date, is_complete, innings, season, location, start_time, end_time, notes, status, is_practice) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
        RETURNING *
      `;
      const values = [
        insertId, 
        league, 
        homeTeamId || null, 
        awayTeamId || null, 
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

      let row: any = null;
      try {
        const { rows } = await pool.query(query, values);
        row = rows[0];
      } catch (insertErr: any) {
        // Fallback if Postgres table has strict UUID constraints on id or foreign keys
        if (insertErr.message && (insertErr.message.includes('type uuid') || insertErr.message.includes('violates foreign key'))) {
          const fallbackValues = [...values];
          if (isStrippedUuid) fallbackValues[0] = strippedId;
          if (fallbackValues[2] && !UUID_REGEX.test(String(fallbackValues[2]))) fallbackValues[2] = null;
          if (fallbackValues[3] && !UUID_REGEX.test(String(fallbackValues[3]))) fallbackValues[3] = null;
          const { rows } = await pool.query(query, fallbackValues);
          row = rows[0];
        } else {
          throw insertErr;
        }
      }

      if (row) {
        if (row.innings && typeof row.innings === 'string') row.innings = JSON.parse(row.innings);
        if (row.tie_breaker && typeof row.tie_breaker === 'string') row.tieBreaker = JSON.parse(row.tie_breaker);
        if (isPracticePrefix && !String(row.id).startsWith('practice-')) {
          row.id = rawId;
        }
      }
      return res.status(201).json(row);
    } 
    else if (req.method === 'PUT') {
      const { id, isComplete, innings, tieBreaker, league, location, startTime, endTime, notes, homeTeamId, awayTeamId, status, isPractice, is_practice } = req.body;
      
      const { rawId, strippedId, isPracticePrefix } = cleanMatchId(id);

      await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS tie_breaker JSONB`);
      
      const practiceFlag = isPractice !== undefined ? isPractice : (is_practice !== undefined ? is_practice : null);

      const queryUpdate = `
        UPDATE matches 
        SET is_complete = COALESCE($3, is_complete), 
            innings = COALESCE($4, innings), 
            tie_breaker = $5, 
            league = COALESCE($6, league),
            location = COALESCE($7, location),
            start_time = COALESCE($8, start_time),
            end_time = COALESCE($9, end_time),
            notes = COALESCE($10, notes),
            home_team_id = COALESCE($11, home_team_id),
            away_team_id = COALESCE($12, away_team_id),
            status = COALESCE($13, status),
            is_practice = COALESCE($14, is_practice)
        WHERE id::text = $1 OR id::text = $2
        RETURNING *
      `;
      const values = [
        rawId,
        strippedId,
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
      const row = rows[0];
      if (row) {
        row.innings = typeof row.innings === 'string' ? JSON.parse(row.innings) : row.innings;
        if (row.tie_breaker) row.tieBreaker = typeof row.tie_breaker === 'string' ? JSON.parse(row.tie_breaker) : row.tie_breaker;
        if (isPracticePrefix && !String(row.id).startsWith('practice-')) {
          row.id = rawId;
        }
      }
      
      return res.status(200).json(row);
    }
    else if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing ID' });
      
      const { rawId, strippedId } = cleanMatchId(id);
      
      const checkRes = await pool.query(
        'SELECT id, is_practice FROM matches WHERE id::text = $1 OR id::text = $2 OR id::text = $3 LIMIT 1',
        [rawId, strippedId, `practice-${strippedId}`]
      );
      
      if (checkRes.rows.length === 0) {
        return res.status(404).json({ error: 'Match not found' });
      }
      
      const targetMatch = checkRes.rows[0];
      if (targetMatch.is_practice !== true) {
        console.warn(`[SECURITY WARNING] Attempted unauthorized deletion of official league match ID: ${targetMatch.id}. Rejecting with 403 Forbidden.`);
        return res.status(403).json({ 
          error: 'Forbidden: Official league matches cannot be deleted. Only practice sessions can be removed.' 
        });
      }
      
      await pool.query('DELETE FROM matches WHERE id::text = $1 OR id::text = $2 OR id::text = $3', [rawId, strippedId, `practice-${strippedId}`]);
      
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
