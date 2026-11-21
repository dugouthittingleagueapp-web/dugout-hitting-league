import type { PoolClient } from 'pg';
import type { Match } from '../types';
import { canonicalCage, scheduleDateKey, scheduleDateTimeError, scheduleTimeMinutes } from '../utils/scheduleValidation.js';
import { scheduleConflict } from '../utils/scheduleConflicts.js';
import { mapMatchFromDB } from '../utils/dbMappers.js';
import { MatchCreationError } from './matchCreation.js';

const dateText = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value || '');

/** Legacy scoring snapshots cannot also act as unvalidated schedule edits. */
export const changesOfficialBooking = (current: Match, body: Record<string, unknown>): boolean => {
  if (current.isPractice || current.is_practice) return false;
  const fields = ['league', 'homeTeamId', 'awayTeamId', 'startTime', 'endTime', 'location', 'date'] as const;
  return fields.some(key => {
    if (body[key] === undefined) return false;
    const a = current[key], b = body[key];
    if (typeof b !== 'string') return b !== a;
    if (key === 'date') return scheduleDateKey(dateText(a)) !== scheduleDateKey(b);
    if (key === 'startTime' || key === 'endTime') return scheduleTimeMinutes(String(a || '')) !== scheduleTimeMinutes(b) || (!a && !!b);
    if (key === 'location') return (canonicalCage(String(a || '')) || a || '') !== (canonicalCage(b) || b);
    if (key === 'league') return String(a || '').trim().toLowerCase() !== b.trim().toLowerCase();
    return a !== b;
  });
};

/** Caller holds the SAME season advisory lock as Admin Schedule transactions. */
export const validateLegacyBooking = async (client: PoolClient, season: string, body: any, practice: boolean) => {
  if (practice) return;
  // Ad-hoc games without a booking remain supported by existing game setup.
  if (!body.startTime && !body.endTime && !body.location) return;
  const error = scheduleDateTimeError(body.date || '', body.startTime || '', body.endTime || '');
  if (error || !canonicalCage(body.location)) throw new MatchCreationError(400, error || 'Choose Tunnels 5/6 or Tunnels 7/8.');
  const rows = await client.query('SELECT * FROM matches WHERE season=$1 AND (is_practice IS FALSE OR is_practice IS NULL)', [season]);
  const conflict = scheduleConflict(body, rows.rows.map(row => ({...mapMatchFromDB(row),date:dateText(row.date)})));
  if (conflict) throw new MatchCreationError(409, conflict);
};
