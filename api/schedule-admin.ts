import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import type { PoolClient } from 'pg';
import pool from './db.js';
import { requireRole } from './auth.js';
import { hasRecordedScores } from '../server/matchWritePolicy.js';

type GameInput = {
  season: string;
  group: string;
  date: string;
  scheduledIsoDate: string;
  startTime: string;
  endTime: string;
  location: string;
  homeTeamName: string;
  awayTeamName: string;
  notes?: string;
};
const safe = (v: unknown, max = 150): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const validSeason = (v: unknown): v is string => typeof v === 'string' && /^20\d\d$/.test(v);
const normalizedDate = (value: string): string | null => {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!iso && !us) return null;
  const year = Number(iso ? iso[1] : us![3]);
  const month = Number(iso ? iso[2] : us![1]);
  const day = Number(iso ? iso[3] : us![2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
};
const validDate = (v: unknown): v is string =>
  typeof v === 'string' && normalizedDate(v) !== null;
const validTime = (v: unknown): v is string =>
  typeof v === 'string' && /^(?:[01]?\d|2[0-3])(?::[0-5]\d)?(?:\s*[ap]m)?$/i.test(v.trim()) &&
  (!/[ap]m/i.test(v) || Number(v.trim().split(':')[0].replace(/[^\d]/g, '')) <= 12);
const validGame = (g: unknown): g is GameInput => {
  if (!g || typeof g !== 'object') return false;
  const x = g as Record<string, unknown>;
  return validSeason(x.season) && validDate(x.date) &&
    safe(x.group, 100) && safe(x.homeTeamName, 120) && safe(x.awayTeamName, 120) &&
    x.homeTeamName.trim().toLowerCase() !== x.awayTeamName.trim().toLowerCase() &&
    typeof x.scheduledIsoDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(x.scheduledIsoDate) &&
    Number.isFinite(Date.parse(x.scheduledIsoDate)) &&
    x.scheduledIsoDate.slice(0, 10) === normalizedDate(x.date) &&
    validTime(x.startTime) && validTime(x.endTime) &&
    typeof x.location === 'string' && x.location.length <= 250 &&
    (x.notes === undefined || (typeof x.notes === 'string' && x.notes.length <= 1000));
};
type DbClient = PoolClient;
const canonical = (s: string): string => s.trim().toLowerCase();
const createInnings = (home: any, away: any): unknown[] => {
  const players = (team: any) => {
    const list = typeof team.players === 'string' ? JSON.parse(team.players) : team.players;
    return (Array.isArray(list) ? list : []).slice(0, 3).map((p: any) => ({
      playerId: p.id, pitches: Array.from({ length: 10 }, () => ({ points: null }))
    }));
  };
  const homePlayers = players(home);
  const awayPlayers = players(away);
  return Array.from({ length: 6 }, (_, i) => ({
    number: i + 1,
    home: { teamId: 'home', playerScores: homePlayers },
    away: { teamId: 'away', playerScores: awayPlayers }
  }));
};

async function importGames(client: DbClient, games: GameInput[], autoCreateTeams: boolean) {
  const leagues = (await client.query('SELECT id, season FROM leagues')).rows;
  const teams = (await client.query('SELECT id, name, league, season, players FROM teams')).rows;
  const matches = (await client.query(
    'SELECT id, league, season, home_team_id, away_team_id, date FROM matches WHERE is_practice IS FALSE'
  )).rows;
  const createdLeagues: string[] = [];
  const createdTeams: string[] = [];
  let createdMatches = 0;
  let skippedDuplicates = 0;

  for (const game of games) {
    let league = leagues.find(l => canonical(l.id) === canonical(game.group) && l.season === game.season);
    if (!league) {
      await client.query('INSERT INTO leagues (id, season) VALUES ($1,$2) ON CONFLICT DO NOTHING', [game.group, game.season]);
      league = { id: game.group, season: game.season };
      leagues.push(league);
      createdLeagues.push(game.group);
    }
    const resolveTeam = async (name: string) => {
      let team = teams.find(t => canonical(t.name) === canonical(name) &&
        canonical(t.league) === canonical(game.group) && t.season === game.season);
      if (team) return team;
      if (!autoCreateTeams) throw new Error('Select two existing teams before creating a scheduled game.');
      const id = crypto.randomUUID();
      const players = Array.from({ length: 3 }, (_, i) => ({
        id: crypto.randomUUID(), name: name.trim() + ' Player ' + (i + 1)
      }));
      const result = await client.query(
        'INSERT INTO teams (id,name,league,season,players,subs) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb) RETURNING id,name,league,season,players',
        [id, name.trim(), game.group, game.season, JSON.stringify(players), '[]']
      );
      team = result.rows[0];
      teams.push(team);
      createdTeams.push(name.trim());
      return team;
    };
    const home = await resolveTeam(game.homeTeamName);
    const away = await resolveTeam(game.awayTeamName);
    if (home.id === away.id) throw new Error('A game cannot have the same team on both sides.');
    const duplicate = matches.some(m => canonical(m.league) === canonical(game.group) &&
      m.season === game.season &&
      new Date(m.date).toISOString().slice(0, 10) === normalizedDate(game.date) &&
      ((m.home_team_id === home.id && m.away_team_id === away.id) ||
       (m.home_team_id === away.id && m.away_team_id === home.id)));
    if (duplicate) { skippedDuplicates++; continue; }
    const id = crypto.randomUUID();
    await client.query(
      'INSERT INTO matches (id,league,season,home_team_id,away_team_id,date,is_complete,innings,location,start_time,end_time,notes,status,is_practice,is_forfeit) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,FALSE,$7::jsonb,$8,$9,$10,$11,$12,FALSE,FALSE)',
      [id, game.group, game.season, home.id, away.id, game.scheduledIsoDate,
        JSON.stringify(createInnings(home, away)), game.location, game.startTime, game.endTime, game.notes || null, 'SCHEDULED']
    );
    matches.push({ id, league: game.group, season: game.season, home_team_id: home.id,
      away_team_id: away.id, date: game.scheduledIsoDate });
    createdMatches++;
  }
  return { totalRows: games.length, createdMatches, skippedDuplicates, createdTeams, createdLeagues, errors: [] as string[] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireRole(req, res, ['admin'])) return;
  if (req.method === 'GET') {
    const { season, league } = req.query;
    if (!validSeason(season) || (league !== undefined && !safe(league, 100))) {
      return res.status(400).json({ error: 'Choose a valid season and division.' });
    }
    try {
      const params: string[] = [season];
      let filter = "m.season=$1 AND m.is_practice IS FALSE";
      if (league) { params.push(league); filter += ' AND LOWER(m.league)=LOWER($2)'; }
      const { rows } = await pool.query(
        'SELECT m.id,m.league,m.season,m.date,m.start_time,m.end_time,m.location,m.status,m.is_complete,m.is_forfeit,m.revision,ht.name AS home_name,at.name AS away_name,' +
        "CASE WHEN m.status='SCHEDULED' AND m.is_complete IS FALSE AND m.is_forfeit IS FALSE AND sl.match_id IS NULL THEN TRUE ELSE FALSE END AS potentially_editable " +
        'FROM matches m LEFT JOIN teams ht ON ht.id=m.home_team_id LEFT JOIN teams at ON at.id=m.away_team_id ' +
        'LEFT JOIN scoring_locks sl ON sl.match_id=m.id WHERE ' + filter + ' ORDER BY m.date,m.start_time,m.id',
        params
      );
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(rows);
    } catch (error) {
      console.error('Schedule manager read failed', error);
      return res.status(500).json({ error: 'Could not load the schedule. Try again.' });
    }
  }
  if (req.method === 'POST') {
    const { action, games } = req.body || {};
    if (!['import', 'create'].includes(action) || !Array.isArray(games) ||
        games.length < 1 || games.length > 250 || (action === 'create' && games.length !== 1) ||
        games.some(g => !validGame(g))) {
      return res.status(400).json({ error: 'The schedule has an invalid row. Correct all highlighted dates, times, teams and divisions before importing.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize imports and single game creation; prevent concurrent duplicate schedule batches.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('dugout_schedule_management'))");
      const result = await importGames(client, games, action === 'import');
      await client.query('COMMIT');
      return res.status(200).json(result);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Atomic schedule import rolled back:', error);
      return res.status(409).json({ error: 'No schedule changes were saved. Check that the selected teams and divisions exist, then try again.' });
    } finally {
      client.release();
    }
  }
  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!safe(id, 128)) return res.status(400).json({ error: 'Choose one game to remove.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('dugout_schedule_management'))");
      const found = await client.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [id]);
      if (!found.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'That game is no longer in the schedule.' }); }
      const m = found.rows[0];
      const locked = await client.query('SELECT 1 FROM scoring_locks WHERE match_id=$1', [id]);
      if (m.is_practice || m.is_complete || m.is_forfeit || m.status !== 'SCHEDULED' ||
          hasRecordedScores(m.innings, m.tie_breaker) || locked.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'This game has already started, has scores, or is locked. It cannot be deleted from the schedule.' });
      }
      await client.query("DELETE FROM matches WHERE id=$1 AND status='SCHEDULED' AND is_complete=FALSE AND is_practice=FALSE", [id]);
      await client.query('COMMIT');
      return res.status(200).json({ success: true, deletedId: id });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Schedule game delete failed', error);
      return res.status(500).json({ error: 'Could not remove the scheduled game. No other games were changed.' });
    } finally {
      client.release();
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
