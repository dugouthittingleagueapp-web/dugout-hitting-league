import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';
import { requireRole } from './auth.js';
import { parsePitchChange } from '../utils/pitchSync.js';

/**
 * Atomic, single-pitch compare-and-set. A correction is accepted only if
 * the database still contains the score the umpire saw. Two devices editing
 * distinct pitches don't replace each other's match JSON.
 *
 * No database migration: innings and tie_breaker are existing JSONB columns.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Only pitch updates are supported.' });
  const role = requireRole(req, res, ['admin', 'umpire']);
  if (!role) return;

  const change = parsePitchChange(req.body);
  if (!change) return res.status(400).json({ error: 'Invalid pitch. Select an existing batter, inning, and a score from 0 to 4.' });

  const path = change.kind === 'regulation'
    ? [String(change.inningIdx), change.side, 'playerScores', String(change.batterIdx), 'pitches', String(change.pitchIdx), 'points']
    : [String(change.roundIdx), change.side === 'home' ? 'homeScores' : 'awayScores', String(change.pitchIdx)];
  const column = change.kind === 'regulation' ? 'innings' : 'tie_breaker';
  const { matchId, expectedPoints, points } = change;
  const stripped = matchId.startsWith('practice-') ? matchId.slice('practice-'.length) : matchId;

  try {
    // PostgreSQL obtains a row lock for UPDATE and rechecks the WHERE clause
    // after other updates commit. A conflicting edit returns 409, never a
    // silent last-writer-wins replacement.
    const query = `
      UPDATE matches
      SET ${column} = jsonb_set(${column}, $3::text[], COALESCE(to_jsonb($4::integer), 'null'::jsonb), false),
          status = CASE WHEN is_complete THEN status ELSE 'IN_PROGRESS' END
      WHERE (id::text = $1 OR id::text = $2)
        AND (is_complete IS NOT TRUE OR $8::boolean)
        AND (${column} #>> $3::text[]) IS NOT DISTINCT FROM $5::text
        ${change.kind === 'regulation'
          ? "AND (innings #>> $6::text[]) = $7::text"
          : "AND (tie_breaker #>> $6::text[]) = $7::text"}
      RETURNING id
    `;
    const identityPath = change.kind === 'regulation'
      ? [String(change.inningIdx), change.side, 'playerScores', String(change.batterIdx), 'playerId']
      : [String(change.roundIdx), change.side === 'home' ? 'homePlayerId' : 'awayPlayerId'];
    const result = await pool.query(query, [
      matchId, stripped, path, points, expectedPoints === null ? null : String(expectedPoints),
      identityPath, change.playerId, role === 'admin'
    ]);
    if (result.rowCount) return res.status(200).json({ saved: true });

    const check = await pool.query(
      'SELECT id, is_complete FROM matches WHERE id::text = $1 OR id::text = $2 LIMIT 1',
      [matchId, stripped]
    );
    if (!check.rowCount) return res.status(404).json({ error: 'Game not found. Return to the schedule and reopen it.' });
    if (check.rows[0].is_complete && role !== 'admin') {
      return res.status(403).json({ error: 'This game has already been finalized. Ask an admin to correct its scores.' });
    }
    return res.status(409).json({
      error: 'This pitch or lineup changed on another device. Your score was kept on this device, but was not applied to the server. Refresh and compare the scores before choosing which one is correct.'
    });
  } catch (error) {
    console.error('[pitch PATCH] Save failure', error);
    return res.status(500).json({ error: 'The pitch could not be saved to the server. Keep this game open and retry after checking the connection.' });
  }
}
