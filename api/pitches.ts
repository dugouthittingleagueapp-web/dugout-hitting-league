import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';
import { requireRole } from './auth.js';
import { validatePitchEdit, type PitchEdit } from '../utils/pitchSync.js';

const isIndex = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

/**
 * Atomic single-pitch write. PostgreSQL locks the current match before checking
 * the expected score and player ID, so independent devices cannot overwrite a
 * newer result. JSONB is changed at one path rather than replacing the client's
 * entire stale match. No database schema migration is needed.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Use PATCH to record a pitch.' });
  const role = requireRole(req, res, ['admin', 'umpire']);
  if (!role) return;

  const edit = req.body as PitchEdit & { lineupIdx?: number };
  const error = validatePitchEdit(edit);
  if (error || (edit.inningIdx !== undefined && !isIndex(edit.lineupIdx, 2))) {
    return res.status(400).json({ error: error || 'Invalid batter position.' });
  }
  const rawId = edit.id.trim();
  const strippedId = rawId.startsWith('practice-') ? rawId.slice(9) : rawId;
  const tie = edit.roundIdx !== undefined;
  const column = tie ? 'tie_breaker' : 'innings';
  const side = edit.side;
  const basePath = tie
    ? [String(edit.roundIdx)]
    : [String(edit.inningIdx), side, 'playerScores', String(edit.lineupIdx)];
  const valuePath = tie
    ? [...basePath, side === 'home' ? 'homeScores' : 'awayScores', String(edit.pitchIdx)]
    : [...basePath, 'pitches', String(edit.pitchIdx), 'points'];
  const playerPath = tie
    ? [...basePath, side === 'home' ? 'homePlayerId' : 'awayPlayerId']
    : [...basePath, 'playerId'];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Never trust client indexes or old score values. The row lock protects
    // the read/compare/write cycle against another umpire's concurrent edit.
    const result = await client.query(
      `SELECT id, is_complete,
              ${column}::jsonb #>> $3::text[] AS current_points,
              ${column}::jsonb #>> $4::text[] AS current_player,
              jsonb_typeof(${column}::jsonb #> $3::text[]) AS existing_kind
       FROM matches WHERE id::text = $1 OR id::text = $2 LIMIT 1 FOR UPDATE`,
      [rawId, strippedId, valuePath, playerPath]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'This game no longer exists. Return to the schedule.' });
    }
    const row = result.rows[0];
    if (row.is_complete && role !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This game is final. Ask an administrator to correct it.' });
    }
    if (row.current_player !== edit.playerId || row.existing_kind === null) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This lineup or pitch has changed. Reload the game before scoring.' });
    }
    const current = row.current_points === null ? null : Number(row.current_points);
    // Response may have been lost after commit. Accept already-applied retry,
    // but only when the addressed pitch/player still exists.
    if (current === edit.points) {
      await client.query('COMMIT');
      return res.status(200).json({ success: true, alreadyApplied: true, id: row.id });
    }
    if (current !== edit.expectedPoints) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Another device updated this pitch. Your score is saved on this device; reload and reconcile it before continuing.',
        currentPoints: current
      });
    }

    const saved = await client.query(
      `UPDATE matches
       SET ${column} = jsonb_set(${column}::jsonb, $2::text[], to_jsonb($3::integer), false),
           status = CASE WHEN is_complete THEN status ELSE 'IN_PROGRESS' END
       WHERE id = $1 RETURNING id`,
      [row.id, valuePath, edit.points]
    );
    if (!saved.rowCount) throw new Error('Match disappeared during pitch save');
    await client.query('COMMIT');
    return res.status(200).json({ success: true, id: row.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[PATCH /api/pitches]', err);
    return res.status(500).json({ error: 'Pitch could not be saved. Your device will retain a local copy.' });
  } finally {
    client.release();
  }
}
