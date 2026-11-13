import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import pool from './db.js';
import { requireRole } from './auth.js';

// A lock stays in place until the original device releases it or an admin
// explicitly transfers it. Never auto-expire during a network interruption.
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const validToken = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9-]{36,64}$/i.test(v);
const canonicalId = (id: unknown) => String(id || '').replace(/^practice-/, '').trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const role = requireRole(req, res, ['admin', 'umpire']);
  if (!role) return;
  const { matchId, token, action } = req.body || {};
  if (!validToken(token) || !canonicalId(matchId) || !['acquire', 'release', 'takeover', 'status'].includes(action)) {
    return res.status(400).json({ error: 'Unable to open scoring. Please return to the schedule and try again.' });
  }
  if (action === 'takeover' && role !== 'admin') {
    return res.status(403).json({ error: 'Only an admin can transfer scoring to another device.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize lock acquisition and match writes on this same match row.
    const match = await client.query('SELECT id, is_complete FROM matches WHERE id::text = $1 FOR UPDATE', [canonicalId(matchId)]);
    if (!match.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Game not found. Return to the schedule and try again.' });
    }
    // Only administrators may acquire scoring access to correct completed games.
    // Umpires still receive the finished-game response and can view read-only.
    if (match.rows[0].is_complete && role !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This game is already finished.' });
    }
    const id = String(match.rows[0].id);
    const stored = await client.query('SELECT token_hash FROM scoring_locks WHERE match_id = $1', [id]);
    const owner = stored.rows[0]?.token_hash;
    if (action === 'status') {
      await client.query('COMMIT');
      return res.json({ owned: owner === hash(token), locked: !!owner });
    }
    if (action === 'release') {
      if (owner === hash(token) || role === 'admin' && !owner) {
        await client.query('DELETE FROM scoring_locks WHERE match_id = $1', [id]);
      }
      await client.query('COMMIT');
      return res.json({ released: owner === hash(token) });
    }
    if (owner && owner !== hash(token) && action !== 'takeover') {
      await client.query('COMMIT');
      return res.status(423).json({ code: 'SCORING_LOCKED', error: 'Another umpire is already scoring this game. Ask an admin if control needs to be transferred.' });
    }
    await client.query(
      `INSERT INTO scoring_locks (match_id, token_hash, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (match_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, updated_at = NOW()`,
      [id, hash(token)]
    );
    await client.query('COMMIT');
    return res.json({ owned: true, locked: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Scoring lock operation failed:', error);
    return res.status(500).json({ error: 'Could not check scoring access. Please try again.' });
  } finally {
    client.release();
  }
}
