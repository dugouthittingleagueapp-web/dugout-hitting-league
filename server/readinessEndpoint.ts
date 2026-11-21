import pool from '../api/db.js';
import { assessGameDay, leagueToday } from './gameDayReadiness.js';
import { mapMatchFromDB, mapTeamFromDB } from '../utils/dbMappers.js';
import { scheduleDateKey } from '../utils/scheduleValidation.js';
import { ScheduleError } from './scheduleTransaction.js';
export const readGameDay = async (season: string, requestedDate: unknown) => {
  const date = typeof requestedDate === 'string' ? scheduleDateKey(requestedDate) : leagueToday();
  if (!date) throw new ScheduleError(400,'Choose a valid game date.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const active = await client.query("SELECT value FROM app_settings WHERE key='current_season'");
    if (active.rows[0]?.value !== season) throw new ScheduleError(409,'The active season changed. Refresh the dashboard.');
    const leagues=await client.query('SELECT id,season FROM leagues WHERE season=$1',[season]);
    const teams=await client.query('SELECT id,name,league,season,players,subs FROM teams WHERE season=$1',[season]);
    const matches=await client.query('SELECT * FROM matches WHERE season=$1 AND (is_practice IS FALSE OR is_practice IS NULL) LIMIT 5001',[season]);
    if (matches.rows.length>5000) throw new ScheduleError(503,'This schedule is too large to check safely. Ask for help reviewing it.');
    const result=assessGameDay(season,date,matches.rows.map(mapMatchFromDB),teams.rows.map(mapTeamFromDB),leagues.rows);
    await client.query('COMMIT');
    return result;
  } catch(error) { await client.query('ROLLBACK').catch(()=>{});throw error; }
  finally {client.release();}
};
