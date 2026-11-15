import pool from '../api/db.js';
import type { PoolClient } from 'pg';
import { scheduleLockedReason } from '../utils/schedulePolicy.js';

export class ScheduleError extends Error {
  constructor(public status: number, message: string, public errors?: string[]) { super(message); }
}

/**
 * Serialize schedule/roster provisioning before inspecting any rows. This also
 * prevents an import or new game from appearing between a league deletion's
 * protection check and its DELETE. No schema changes or persistent lock rows.
 */
export const withActiveSeason = async <T>(
  requestedSeason: unknown,
  work: (client: PoolClient, season: string) => Promise<T>
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(676867, 1)');
    // FOR SHARE holds the season stable until this transaction completes.
    const result = await client.query("SELECT value FROM app_settings WHERE key = 'current_season' FOR SHARE");
    const active = result.rows[0]?.value;
    if (typeof active !== 'string' || !/^\d{4}$/.test(active))
      throw new ScheduleError(409, 'The active season is unavailable. Refresh and try again.');
    if (requestedSeason !== undefined && requestedSeason !== active)
      throw new ScheduleError(403, 'Only the active season can be changed. Archived seasons are preserved. Refresh and try again.');
    const data = await work(client, active);
    await client.query('COMMIT');
    return data;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
};

/** Call after locking the corresponding match rows (same order as scoring-lock acquisition). */
export const assertScheduleGamesUnlocked = async (client: PoolClient, games: { id: string }[]): Promise<void> => {
  if (!games.length) return;
  const locks = await client.query('SELECT match_id FROM scoring_locks WHERE match_id = ANY($1::text[])', [games.map(game => String(game.id))]);
  const open = new Set(locks.rows.map(row => String(row.match_id)));
  for (const game of games) {
    const reason = scheduleLockedReason({ ...game, scoringLocked: open.has(String(game.id)) });
    if (reason) throw new ScheduleError(409, reason);
  }
};
