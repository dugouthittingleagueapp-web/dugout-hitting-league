import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import pool from './db.js';

/**
 * Read-only incremental dashboard refresh. The first dashboard load uses
 * GET /api/matches. Subsequent refreshes send the versions already displayed
 * and receive only added/changed games plus IDs no longer in the schedule.
 * Nothing about scoring or writes is changed here.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { league, season, excludePractice, versions } = req.body || {};
    if (typeof league !== 'string' || !league || league.length > 100 ||
        typeof season !== 'string' || !/^\d{4}$/.test(season) ||
        !versions || Array.isArray(versions) || typeof versions !== 'object') {
      return res.status(400).json({ error: 'Invalid dashboard request' });
    }

    const keys = Object.keys(versions);
    if (keys.length > 3000 || keys.some(id => id.length > 128 ||
        !Number.isSafeInteger(versions[id]) || versions[id] < 0)) {
      return res.status(400).json({ error: 'Invalid dashboard versions' });
    }

    const params: unknown[] = [league, season];
    const where = [
      'LOWER(league) = LOWER($1)',
      season === '2025' ? '(season = $2 OR season IS NULL)' : 'season = $2'
    ];
    if (excludePractice === true) where.push('(is_practice IS FALSE OR is_practice IS NULL)');
    const filter = where.join(' AND ');
    const manifest = await pool.query(
      `SELECT id, revision, is_practice FROM matches WHERE ${filter} ORDER BY id ASC`,
      params
    );

    const visibleId = (row: any) =>
      row.is_practice && !String(row.id).startsWith('practice-')
        ? `practice-${row.id}` : String(row.id);
    const remaining = new Set<string>();
    const changedIds: string[] = [];
    for (const row of manifest.rows) {
      const id = visibleId(row);
      remaining.add(id);
      if (versions[id] !== Number(row.revision ?? 0)) changedIds.push(String(row.id));
    }
    const removedIds = keys.filter(id => !remaining.has(id));

    // Return the same signature used by the full list GET so the fallback
    // conditional route continues to work.
    const signature = crypto.createHash('sha256')
      .update(JSON.stringify(manifest.rows.map((row: any) =>
        [String(row.id), String(row.revision ?? 0)])))
      .digest('hex');

    const changed = changedIds.length
      ? (await pool.query('SELECT * FROM matches WHERE id::text = ANY($1::text[])', [changedIds])).rows
      : [];
    const rows = changed.map((row: any) => {
      if (typeof row.innings === 'string') row.innings = JSON.parse(row.innings);
      if (typeof row.tie_breaker === 'string') row.tie_breaker = JSON.parse(row.tie_breaker);
      row.isForfeit = row.is_forfeit === true;
      row.forfeitingTeamId = row.forfeiting_team_id;
      row.forfeitReason = row.forfeit_reason;
      row.id = visibleId(row);
      return row;
    });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ changed: rows, removedIds, signature });
  } catch (error) {
    console.error('Dashboard refresh failed:', error);
    return res.status(500).json({ error: 'Unable to refresh games right now' });
  }
}
