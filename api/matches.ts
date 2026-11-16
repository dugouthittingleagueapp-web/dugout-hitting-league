import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import pool from './db.js';
import { changesPracticeClassification, hasRecordedScores } from '../server/matchWritePolicy.js';
import { requireRole, getAuthFromRequest } from './auth.js';
import { withActiveMatchSeason, MatchCreationError } from '../server/matchCreation.js';
import { mapMatchFromDB, mapTeamFromDB } from '../utils/dbMappers.js';
import { applyPitchCommand, validatePitchCommand, stableJson, ScoringProtocolError } from '../utils/scoringProtocol.js';
import { validateScoreState, validateScoringFlags, validatedForfeitWinner, assertSafeSnapshotTransition } from '../server/scoringValidation.js';

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
      const { league, id, season, excludePractice } = req.query;
      if (id) {
        const { rawId, strippedId } = cleanMatchId(id);
        // Spectators keep a complete local snapshot for inning navigation.
        // A cheap revision check avoids transferring every historical pitch
        // when the game has not changed since their last refresh.
        const spectatorRevision = req.query.spectatorRevision;
        if (typeof spectatorRevision === 'string' && /^\d+$/.test(spectatorRevision)) {
          const current = await pool.query(
            'SELECT revision FROM matches WHERE id::text = $1 OR id::text = $2 LIMIT 1',
            [rawId, strippedId]
          );
          if (current.rows.length && String(current.rows[0].revision) === spectatorRevision) {
            res.setHeader('Cache-Control', 'private, no-store');
            return res.status(304).end();
          }
        }
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

      // Dashboard viewers already have the complete match list. Compare
      // lightweight (id, revision) pairs before transferring inning histories.
      const dashboardSignature = req.query.dashboardSignature;
      const wantsConditionalList = typeof dashboardSignature === 'string' &&
        /^[0-9a-f]{64}$/.test(dashboardSignature);

      let query = 'SELECT * FROM matches';
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
      
      if (wantsConditionalList) {
        const lightQuery = query.replace('SELECT * FROM matches', 'SELECT id, revision FROM matches') +
          ' ORDER BY id ASC';
        const current = await pool.query(lightQuery, params);
        const signature = crypto.createHash('sha256')
          .update(JSON.stringify(current.rows.map(row => [String(row.id), String(row.revision ?? 0)])))
          .digest('hex');
        if (signature === dashboardSignature) {
          res.setHeader('Cache-Control', 'private, no-store');
          res.setHeader('X-Dashboard-Signature', signature);
          return res.status(304).end();
        }
      }

      query += ' ORDER BY date ASC, start_time ASC, id ASC';
      const { rows } = await pool.query(query, params);
      // Supply the signature on a full response so subsequent dashboard
      // refreshes need only fetch the small revision list.
      const signatureRows = rows.map(row => [String(row.id), String(row.revision ?? 0)])
        .sort((a, b) => a[0].localeCompare(b[0]));
      const signature = crypto.createHash('sha256').update(JSON.stringify(signatureRows)).digest('hex');
      res.setHeader('X-Dashboard-Signature', signature);
      res.setHeader('Cache-Control', 'private, no-store');
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
      validateScoringFlags(req.body || {});

      const row = await withActiveMatchSeason(season, async (client, matchSeason) => {
        if (typeof league !== 'string' || typeof homeTeamId !== 'string' || typeof awayTeamId !== 'string' || homeTeamId === awayTeamId)
          throw new MatchCreationError(400, 'Choose a league and two different teams.');
        const destination = await client.query('SELECT id FROM leagues WHERE season = $1 AND LOWER(TRIM(id)) = LOWER(TRIM($2))', [matchSeason, league]);
        if (destination.rows.length !== 1) throw new MatchCreationError(400, 'Choose a league in the active season.');
        const teams = await client.query('SELECT * FROM teams WHERE id = ANY($1::text[]) AND season = $2 AND LOWER(TRIM(league)) = LOWER(TRIM($3))', [[homeTeamId, awayTeamId], matchSeason, league]);
        if (teams.rows.length !== 2) throw new MatchCreationError(400, 'Both teams must belong to this league in the active season.');

        if ((isComplete !== undefined && isComplete !== false) || (status !== undefined && !['SCHEDULED', 'IN_PROGRESS'].includes(status)) || hasRecordedScores(innings, req.body.tieBreaker))
          throw new MatchCreationError(400, 'Create an unplayed game first. Recorded results must use scoring access.');
        validateScoreState({ ...req.body, is_practice: matchIsPractice, tieBreaker: req.body.tieBreaker },
          mapTeamFromDB(teams.rows.find(t => t.id === homeTeamId)), mapTeamFromDB(teams.rows.find(t => t.id === awayTeamId)));

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
          destination.rows[0].id,
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
          validatedForfeitWinner(matchIsForfeit, forfeitTeamId, winningId, homeTeamId, awayTeamId)
        ];

        const { rows } = await client.query(query, values);
        const row = rows[0];
        if (isPracticePrefix && row && !String(row.id).startsWith('practice-')) row.id = rawId;
        return row;
      });

      if (row) {
        if (row.innings && typeof row.innings === 'string') row.innings = JSON.parse(row.innings);
        if (row.tie_breaker && typeof row.tie_breaker === 'string') row.tieBreaker = JSON.parse(row.tie_breaker);
        row.isForfeit = row.is_forfeit === true;
        row.forfeitingTeamId = row.forfeiting_team_id;
        row.forfeitReason = row.forfeit_reason;
      }
      return res.status(201).json(row);
    } 
    else if (req.method === 'PUT') {
      // Server-Side Authorization:
      // Scoring and updating matches allowed for ADMIN and UMPIRE
      const role = requireRole(req, res, ['admin', 'umpire']);
      if (!role) return;
      validateScoringFlags(req.body || {});

      const {
        revision, id, isComplete, innings, tieBreaker, league, location, startTime, 
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
        SET revision = revision + 1,
            is_complete = COALESCE($3, is_complete), 
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

      // Lock the match row before checking ownership. The lock endpoint uses
      // the same row lock, preventing a takeover from racing a pitch write.
      const client = await pool.connect();
      let row: any;
      try {
        await client.query('BEGIN');
        const target = await client.query(
          'SELECT * FROM matches WHERE id::text = $1 OR id::text = $2 FOR UPDATE',
          [rawId, strippedId]
        );
        if (!target.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Game not found. No changes were saved.' });
        }
        const current = mapMatchFromDB(target.rows[0]);
        const command = req.body.command === undefined ? undefined : validatePitchCommand(req.body.command);
        const writeId = req.body.writeId;
        if ((command && (typeof writeId !== 'string' || !UUID_REGEX.test(writeId))) ||
            (writeId !== undefined && (typeof writeId !== 'string' || !UUID_REGEX.test(writeId))))
          throw new ScoringProtocolError('INVALID_COMMAND', 'This save needs a valid recovery number. No changes were saved.');
        if (command && Object.keys(req.body).some(k => !['id', 'revision', 'writeId', 'command'].includes(k)))
          throw new ScoringProtocolError('INVALID_COMMAND', 'A pitch save cannot change other game information.');
        const supplied = req.headers['x-scoring-token'];
        const callerHash = crypto.createHash('sha256').update(typeof supplied === 'string' ? supplied : '').digest('hex');
        const digest = writeId ? crypto.createHash('sha256').update(stableJson(req.body)).digest('hex') : '';
        const receiptKey = `scoring_ack:${current.id}`;
        if (writeId) {
          const prior = await client.query('SELECT value FROM app_settings WHERE key = $1', [receiptKey]);
          const receipt = prior.rows[0] ? JSON.parse(prior.rows[0].value) : null;
          if (receipt?.writeId === writeId) {
            if (receipt.digest !== digest || receipt.callerHash !== callerHash || receipt.role !== role || receipt.revision !== current.revision)
              throw new ScoringProtocolError('PITCH_CONFLICT', 'This recovery save needs checking. No changes were applied.');
            await client.query('COMMIT');
            if (isPracticePrefix && !String(target.rows[0].id).startsWith('practice-')) target.rows[0].id = rawId;
            return res.status(200).json(target.rows[0]);
          }
        }
        // Official/practice identity is set at game creation. Never let a PUT
        // turn a protected official game into a deletable practice game (or
        // a practice game into official statistics).
        if (changesPracticeClassification(target.rows[0].is_practice, practiceFlag)) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            code: 'GAME_TYPE_LOCKED',
            error: 'This game is already saved as official or practice. Its game type cannot be changed.'
          });
        }
        // Completed results may only be corrected by admins. A correction
        // does not reopen the game; changes still require a matching revision
        // and the admin's scoring lock, just like other pitch writes.
        if (target.rows[0].is_complete === true && role !== 'admin') {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'This game is finished. Only an admin can correct its scores.' });
        }
        const lock = await client.query(
          'SELECT token_hash FROM scoring_locks WHERE match_id = $1',
          [String(target.rows[0].id)]
        );
        const owner = lock.rows[0]?.token_hash;
        const suppliedToken = req.headers['x-scoring-token'];
        const token = typeof suppliedToken === 'string' ? suppliedToken : '';
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const scoringStarted = !!command || target.rows[0].status === 'IN_PROGRESS' ||
          status === 'IN_PROGRESS' || target.rows[0].is_complete === true ||
          isComplete === true ||
          hasRecordedScores(target.rows[0].innings, target.rows[0].tie_breaker) ||
          hasRecordedScores(innings, tieBreaker);
        if ((scoringStarted || !!owner) && (!owner || !token || tokenHash !== owner)) {
          await client.query('ROLLBACK');
          return res.status(423).json({
            code: 'SCORING_LOCKED',
            error: owner
              ? 'Another umpire is already scoring this game. Ask an admin to transfer control.'
              : 'Scoring is not ready yet. Reopen the game to secure scoring access.'
          });
        }
        // Compare before writing: a delayed offline snapshot must never replace
        // a match that has been modified since the snapshot was created.
        if (revision !== undefined && revision !== null &&
            (!Number.isSafeInteger(revision) || revision !== Number(target.rows[0].revision))) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            code: 'STALE_MATCH',
            error: 'This game has newer scores on the server. Your older changes were not applied. Ask an admin to review before scoring again.'
          });
        }
        if ((scoringStarted || !!owner) && !Number.isSafeInteger(revision)) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            code: 'MISSING_REVISION',
            error: 'Please reopen this game before entering more scores.'
          });
        }
        const next = command ? applyPitchCommand(current, command) : {
          ...current,
          ...(innings !== undefined ? { innings } : {}),
          ...(tieBreaker !== undefined ? { tieBreaker } : {}),
          ...(isComplete !== undefined ? { isComplete } : {}),
          ...(status !== undefined ? { status } : isComplete === true ? { status: 'FINAL' as const } : {}),
          ...(homeTeamId !== undefined ? { homeTeamId } : {}),
          ...(awayTeamId !== undefined ? { awayTeamId } : {}),
        };
        if (typeof next.isComplete !== 'boolean' || !['SCHEDULED', 'IN_PROGRESS', 'FINAL'].includes(next.status || '') ||
            (!next.isComplete && next.status === 'FINAL') || (!current.isComplete && next.isComplete && next.status !== 'FINAL'))
          throw new ScoringProtocolError('INVALID_SCORING_STATE', 'The game status is not valid. No changes were saved.');
        const rosterRows = await client.query('SELECT * FROM teams WHERE id = ANY($1::text[])', [[next.homeTeamId, next.awayTeamId]]);
        const home = rosterRows.rows.find(t => t.id === next.homeTeamId), away = rosterRows.rows.find(t => t.id === next.awayTeamId);
        if (!home || !away || home.id === away.id) throw new ScoringProtocolError('INVALID_SCORING_STATE', 'Both teams must be available. No changes were saved.');
        validateScoreState(next, mapTeamFromDB(home), mapTeamFromDB(away));
        const effectiveForfeit = forfeitFlag ?? current.isForfeit ?? false;
        const effectiveForfeiter = forfeitTeamId ?? current.forfeitingTeamId;
        values[17] = validatedForfeitWinner(effectiveForfeit, effectiveForfeiter, winningId ?? current.winningTeamId, next.homeTeamId, next.awayTeamId);
        if (effectiveForfeit) values[15] = effectiveForfeiter;
        if (!command) assertSafeSnapshotTransition(current, next, req.body.intent, role);
        values[2] = next.isComplete;
        values[3] = JSON.stringify(next.innings);
        values[4] = next.tieBreaker?.length ? JSON.stringify(next.tieBreaker) : null;
        values[12] = next.status;
        const result = await client.query(queryUpdate, values);
        row = result.rows[0];
        if (writeId) await client.query(
          'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
          [receiptKey, JSON.stringify({ writeId, digest, callerHash, role, revision: Number(row.revision) })]);
        // Finalizing an active game releases its scoring lock. Admin score
        // corrections on an ALREADY finalized game retain the lock so multiple
        // confirmed corrections remain possible in the same editing session.
        if (row?.is_complete && !target.rows[0].is_complete) {
          await client.query('DELETE FROM scoring_locks WHERE match_id = $1', [String(row.id)]);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
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
    if (error instanceof MatchCreationError) return res.status(error.status).json({ error: error.message });
    if (error instanceof ScoringProtocolError) return res.status(['PITCH_CONFLICT', 'SCORE_HISTORY_LOCKED', 'FINAL_GAME_LOCKED'].includes(error.code) ? 409 : 400).json({ code: error.code, error: error.message });
    console.error('[API] Matches Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
