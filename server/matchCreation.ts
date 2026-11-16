import pool from '../api/db.js';
import type { PoolClient } from 'pg';

export class MatchCreationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Validate and insert a new game atomically while its active season stays fixed.
 * This scoring release does not introduce the Admin Schedule import/edit APIs.
 */
export const withActiveMatchSeason = async <T>(requested: unknown,
  work: (client: PoolClient, season: string) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(676867, 1)');
    const result = await client.query("SELECT value FROM app_settings WHERE key = 'current_season' FOR SHARE");
    const active = result.rows[0]?.value;
    if (typeof active !== 'string' || !/^\d{4}$/.test(active))
      throw new MatchCreationError(409, 'The active season is unavailable. Refresh and try again.');
    if (requested !== undefined && requested !== active)
      throw new MatchCreationError(403, 'Only the active season can be changed. Archived seasons are preserved. Refresh and try again.');
    const saved = await work(client, active);
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
};
