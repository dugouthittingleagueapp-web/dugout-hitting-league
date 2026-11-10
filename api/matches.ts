import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';
import { requireRole, getAuthFromRequest } from './auth.js';

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
    if (req.method === 'GET') {
      const { league, id, season, excludePractice, revisions } = req.query;
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
        row.isForfeit = row.is_forfeit === true;
        row.forfeitingTeamId = row.forfeiting_team_id;
        row.forfeitReason = row.forfeit_reason;
        if (rawId.startsWith('practice-') && !String(row.id).startsWith('practice-')) {
          row.id = rawId;
        }
        return res.status(200).json(row);
      }

      // Lightweight change detection for dashboard polling. Returning only IDs and
      // fingerprints avoids sending entire inning/pitch JSON to clients every 30s.
      // Hash the complete stored row so edits to scores, metadata, or forfeits all
      // invalidate the revision. This is read-only and changes no scoring data.
      let query = revisions === 'true'
        ? "SELECT m.id::text AS id, m.is_practice, md5(row_to_json(m)::text) AS revision FROM matches m"
        : 'SELECT * FROM matches';
      const params: any[] = [];
      let paramCount = 1;
      
      // Dynamic where clause
      const conditions: string[] = [];
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
      
      // Strict Official Statistics Isolation Clause:
      // Excludes practice matches completely when excludePractice is requested
      if (excludePractice === 'true') {
        conditions.push(`(is_practice IS FALSE OR is_practice IS NULL)`);
      }
      
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY date ASC, start_time ASC, id ASC';
      const { rows } = await pool.query(query, params);
      if (revisions === 'true') {
        return res.status(200).json(rows.map(row => ({
          id: row.is_practice && !String(row.id).startsWith('practice-')
            ? `practice-${row.id}`
            : String(row.id),
          revision: row.revision
        })));
      }
      const mappedRows = rows.map(row => {
        if (row.innings && typeof row.innings === 'string') row.innings = JSON.parse(row.innings);
        if (row.tie_breaker && typeof row.tie_breaker === 'string') row.tieBreaker = JSON.parse(row.tie_breaker);
        row.isForfeit = row.is_forfeit === true;
        row.forfeitingTeamId = row.forfeiting_team_id;
        row.forfeitReason = row.forfeit_reason;
        if (row.is_practice && !String(row.id).startsWith('practice-')) {
          row.id = `practice-${row.id}`;
        }
        return row;
      });

      // Strict chronological ascending sort: date ASC, start_time ASC
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
      const { 
        id, league, homeTeamId, awayTeamId, date, isComplete, innings, season, 
        location, startTime, endTime, notes, status, isPractice, is_practice,
        isForfeit, is_forfeit, forfeitingTeamId, forfeiting_team_id, winningTeamId, winning_team_id, forfeitReason, forfeit_reason
      } = req.body || {};
      
      const matchIsPractice = isPractice === true || is_practice === true;
      const matchIsForfeit = isForfeit === true || is_forfeit === true;
      const forfeitTeamId = forfeitingTeamId || forfeiting_team_id || null;
      const forfeitNote = forfeitReason || forfeit_reason || null;
      const winningId = winningTeamId || winning_team_id || null;

      // Server-Side Authorization:
      // Both authenticated admins and umpires may start official or practice games.
      const allowedRoles = ['admin', 'umpire'];
      const role = requireRole(req, res, allowedRoles as ('admin' | 'umpire')[]);
      if (!role) return;

      let matchSeason = season;
      if (!matchSeason) {
        try {
          const sRes = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
          matchSeason = sRes.rows[0]?.value;
        } catch (e) {}
      }
      if (!matchSeason) matchSeason = new Date().getFullYear().toString();

      const matchStatus = status || (isComplete ? 'FINAL' : 'SCHEDULED');

      const { rawId, strippedId, isPracticePrefix, isStrippedUuid } = cleanMatchId(id);
      const insertId = isPracticePrefix && isStrippedUuid ? strippedId : rawId;

      const query = `
        INSERT INTO matches (
          id, league, home_team_id, away_team_id, date, is_complete, innings, season, 
          location, start_time, end_time, notes, status, is_practice, is_forfeit, forfeiting_team_id, forfeit_reason, winning_team_id
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) 
        RETURNING *
      `;
      const values = [
        insertId, 
        league, 
        homeTeamId || null, 
        awayTeamId || null, 
        date || new Date().toISOString(), 
        isComplete ?? false, 
        JSON.stringify(innings || []), 
        matchSeason,
        location || null,
        startTime || null,
        endTime || null,
        notes || null,
        matchStatus,
        matchIsPractice,
        matchIsForfeit,
        forfeitTeamId,
        forfeitNote,
        winningId
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
        row.isForfeit = row.is_forfeit === true;
        row.forfeitingTeamId = row.forfeiting_team_id;
        row.forfeitReason = row.forfeit_reason;
        if (isPracticePrefix && !String(row.id).startsWith('practice-')) {
          row.id = rawId;
        }
      }
      return res.status(201).json(row);
    } 
    else if (req.method === 'PUT') {
      // Server-Side Authorization:
      // Scoring and updating matches allowed for ADMIN and UMPIRE
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;

      const { 
        id, isComplete, innings, tieBreaker, league, location, startTime, 
        endTime, notes, homeTeamId, awayTeamId, status, isPractice, is_practice,
        isForfeit, is_forfeit, forfeitingTeamId, forfeiting_team_id, winningTeamId, winning_team_id, forfeitReason, forfeit_reason
      } = req.body || {};
      
      const { rawId, strippedId, isPracticePrefix } = cleanMatchId(id);
      const practiceFlag = isPractice !== undefined ? isPractice : (is_practice !== undefined ? is_practice : null);
      const forfeitFlag = isForfeit !== undefined ? isForfeit : (is_forfeit !== undefined ? is_forfeit : null);
      const forfeitTeamId = forfeitingTeamId !== undefined ? forfeitingTeamId : (forfeiting_team_id !== undefined ? forfeiting_team_id : null);
      const forfeitNote = forfeitReason !== undefined ? forfeitReason : (forfeit_reason !== undefined ? forfeit_reason : null);
      const winningId = winningTeamId !== undefined ? winningTeamId : (winning_team_id !== undefined ? winning_team_id : null);

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
            is_practice = COALESCE($14, is_practice),
            is_forfeit = COALESCE($15, is_forfeit),
            forfeiting_team_id = CASE WHEN $15::boolean = FALSE THEN NULL ELSE COALESCE($16, forfeiting_team_id) END,
            forfeit_reason = CASE WHEN $15::boolean = FALSE THEN NULL ELSE COALESCE($17, forfeit_reason) END,
            winning_team_id = CASE WHEN $15::boolean = FALSE THEN NULL ELSE COALESCE($18, winning_team_id) END
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
        practiceFlag,
        forfeitFlag,
        forfeitTeamId,
        forfeitNote,
        winningId
      ];

      const { rows } = await pool.query(queryUpdate, values);
      const row = rows[0];
      if (!row) return res.status(404).json({ error: 'Match not found; no scoring data was saved.' });
      if (row) {
        row.innings = typeof row.innings === 'string' ? JSON.parse(row.innings) : row.innings;
        if (row.tie_breaker) row.tieBreaker = typeof row.tie_breaker === 'string' ? JSON.parse(row.tie_breaker) : row.tie_breaker;
        row.isForfeit = row.is_forfeit === true;
        row.forfeitingTeamId = row.forfeiting_team_id;
        row.forfeitReason = row.forfeit_reason;
        if (isPracticePrefix && !String(row.id).startsWith('practice-')) {
          row.id = rawId;
        }
      }
      
      return res.status(200).json(row);
    }
    else if (req.method === 'DELETE') {
      // PRIORITY 1 — ABSOLUTE PROTECTION OF OFFICIAL MATCHES
      // Step 1: Server-Side Authorization check (Admin & Umpire allowed for practice sessions)
      const auth = getAuthFromRequest(req);
      if (!auth.authenticated) {
        return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
      }
      if (auth.role !== 'admin' && auth.role !== 'umpire') {
        return res.status(403).json({ error: 'Forbidden: Insufficient permissions to delete matches.' });
      }

      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing ID' });
      
      const { rawId, strippedId } = cleanMatchId(id);
      
      // Step 2: Prevent race conditions using PostgreSQL transaction and row lock (FOR UPDATE)
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const checkRes = await client.query(
          `SELECT id, is_practice FROM matches 
           WHERE id::text = $1 OR id::text = $2 OR id::text = $3 
           FOR UPDATE LIMIT 1`,
          [rawId, strippedId, `practice-${strippedId}`]
        );
        
        if (checkRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Match not found' });
        }
        
        const targetMatch = checkRes.rows[0];
        
        // Step 3: Absolute backend delete guard
        // Deletion rejected unless database record explicitly contains is_practice === true
        if (targetMatch.is_practice !== true) {
          await client.query('ROLLBACK');
          console.warn(`[SECURITY WARNING] Attempted deletion of official league match ID: ${targetMatch.id} by role: ${auth.role}. Rejecting with 403 Forbidden.`);
          return res.status(403).json({ 
            error: 'Forbidden: Official league matches cannot be deleted. Only practice sessions can be removed.' 
          });
        }
        
        // Step 4: Atomic conditional deletion strictly enforcing is_practice IS TRUE
        const delRes = await client.query(
          `DELETE FROM matches 
           WHERE (id::text = $1 OR id::text = $2 OR id::text = $3) 
             AND is_practice IS TRUE 
           RETURNING id`,
          [rawId, strippedId, `practice-${strippedId}`]
        );

        if (delRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Match could not be deleted or is not a practice match.' });
        }
        
        await client.query('COMMIT');
        return res.status(200).json({ success: true, deletedId: delRes.rows[0].id });
      } catch (transErr: any) {
        await client.query('ROLLBACK');
        console.error('[DELETE /api/matches] Database failure:', transErr);
        return res.status(500).json({ error: 'Database failure during match deletion.' });
      } finally {
        client.release();
      }
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('[API] Matches Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
