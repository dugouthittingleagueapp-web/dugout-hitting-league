import type { PoolClient } from 'pg';
import type { ScheduleBooking } from '../utils/scheduleConflicts.js';

/** Read every league's official bookings inside the serialized schedule transaction. */
export const readScheduleBookings = async (client: PoolClient, season: string): Promise<ScheduleBooking[]> => {
  const result = await client.query(
    `SELECT m.id, m.league, m.season, m.date, m.start_time AS "startTime", m.end_time AS "endTime", m.location,
     m.home_team_id AS "homeTeamId", m.away_team_id AS "awayTeamId", h.name AS "homeTeamName", a.name AS "awayTeamName"
     FROM matches m LEFT JOIN teams h ON h.id = m.home_team_id LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.season = $1 AND (m.is_practice IS FALSE OR m.is_practice IS NULL)`, [season]
  );
  return result.rows.map(row => ({ ...row, date: row.date instanceof Date ? row.date.toISOString() : String(row.date) }));
};
