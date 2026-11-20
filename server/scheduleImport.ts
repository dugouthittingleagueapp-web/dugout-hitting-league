import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { League, Match, Team, ScheduleImportDestination, ScheduleImportPreview } from '../types';
import { parseScheduleCsv, isDuplicateMatch } from '../utils/scheduleImporter.js';
import { normalizeLeague } from '../utils/leagueNames.js';
import { createEmptyInning } from '../utils/inningTemplate.js';
import { ScheduleError } from './scheduleTransaction.js';
import { scheduleConflict } from '../utils/scheduleConflicts.js';

export interface ImportPlan extends ScheduleImportPreview {
  replacements:Record<string,string>;
  teamReplacements:Record<string,string>;
  leaguesToCreate: League[];
  teamsToCreate: Team[];
  matchesToCreate: Match[];
}

/** Same planner for preflight and commit. No writes occur while making a plan. */
export const planScheduleImport = async (client: PoolClient, season: string, csvText: unknown, destinations: unknown, allowConflicts = false): Promise<ImportPlan> => {
  if (typeof csvText !== 'string' || !csvText.trim() || Buffer.byteLength(csvText, 'utf8') > 1_000_000)
    throw new ScheduleError(400, 'Choose a schedule CSV smaller than 1 MB.');
  if (!destinations || typeof destinations !== 'object' || Array.isArray(destinations))
    throw new ScheduleError(400, 'Choose a destination league for every CSV group.');
  const seed=importReceiptKey(season,csvText,destinations);
  const stableId=(label:string)=>{const hex=createHash('sha256').update(seed+label).digest('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;};
  const parsed = parseScheduleCsv(csvText, { defaultSeason: season });
  if (parsed.errors.length) throw new ScheduleError(400, 'Fix the CSV rows below. No games were imported.', parsed.errors);
  if (!parsed.games.length || parsed.games.length > 1000)
    throw new ScheduleError(400, 'Import between 1 and 1,000 games at a time.');

  const groups = [...new Set(parsed.games.map(game => game.csvGroup || game.group))];
  const choices = new Map<string, ScheduleImportDestination>();
  for (const group of groups) {
    const choice = Object.prototype.hasOwnProperty.call(destinations, group)
      ? (destinations as Record<string, ScheduleImportDestination>)[group] : null;
    if (!choice || !['new', 'existing'].includes(choice.mode) || typeof choice.name !== 'string' || !choice.name.trim() || choice.name.trim().length > 100)
      throw new ScheduleError(400, `Choose a valid destination league for "${group}".`);
    choices.set(group, { mode: choice.mode, name: choice.name.trim() });
  }

  const leagues: League[] = (await client.query('SELECT id, season FROM leagues WHERE season = $1', [season])).rows;
  const teams: Team[] = (await client.query('SELECT id, name, league, season, players, subs FROM teams WHERE season = $1', [season])).rows;
  const matches: Match[] = (await client.query(
    'SELECT id, league, season, home_team_id AS "homeTeamId", away_team_id AS "awayTeamId", date, start_time AS "startTime", end_time AS "endTime", location, is_practice FROM matches WHERE season = $1 AND (is_practice IS FALSE OR is_practice IS NULL)', [season]
  )).rows.map(row => ({ ...row, date: row.date instanceof Date ? row.date.toISOString() : String(row.date) }));
  const plan: ImportPlan = {
    replacements:{},teamReplacements:{},games: [], leaguesToCreate: [], teamsToCreate: [], matchesToCreate: [],
    summary: { totalRows: parsed.games.length, createdMatches: 0, skippedDuplicates: 0, createdLeagues: [], createdTeams: [], errors: [] }
  };
  const resolved = new Map<string, string>();
  for (const [group, choice] of choices) {
    const candidates = leagues.filter(league => normalizeLeague(league.id) === normalizeLeague(choice.name));
    if (candidates.length > 1) throw new ScheduleError(409, `More than one league matches "${choice.name}". Ask an admin to review the league names.`);
    if (!candidates.length && choice.mode === 'existing') throw new ScheduleError(409, `League "${choice.name}" is no longer available in ${season}. Refresh and choose again.`);
    // Reuse matching names on retry; never replace an existing league or its teams.
    let league = candidates[0];
    if (!league) {
      league = { id: choice.name, season };
      leagues.push(league);
      plan.leaguesToCreate.push(league);
      plan.summary.createdLeagues.push(league.id);
    }
    resolved.set(group, league.id);
  }

  const teamFor = (name: string, league: string): Team => {
    const candidates = teams.filter(team => normalizeLeague(team.league) === normalizeLeague(league) && team.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (candidates.length > 1) throw new ScheduleError(409, `More than one team is named "${name}" in ${league}. Ask an admin to review it.`);
    if (candidates[0]) {plan.teamReplacements[stableId('team:'+normalizeLeague(league)+':'+name.trim().toLowerCase())]=candidates[0].id;return candidates[0];}
    const team: Team = { id: stableId('team:'+normalizeLeague(league)+':'+name.trim().toLowerCase()), name: name.trim(), league, season, subs: [], players: [] };
    teams.push(team);
    plan.teamsToCreate.push(team);
    plan.summary.createdTeams.push(team.name);
    return team;
  };
  for (const [rowIndex,source] of parsed.games.entries()) {
    const game = { ...source, group: resolved.get(source.csvGroup || source.group)!, season };
    const home = teamFor(game.homeTeamName, game.group);
    const away = teamFor(game.awayTeamName, game.group);
    const duplicate = isDuplicateMatch(game, home.id, away.id, matches);
    plan.games.push({ ...game, duplicate });
    if (duplicate) {
      const existing=matches.find(match=>isDuplicateMatch(game,home.id,away.id,[match]))!;
      plan.replacements[stableId('game:'+rowIndex)]=existing.id;
      plan.summary.skippedDuplicates++; continue;
    }
    const players = (team: Team): string[] => {
      const roster = typeof team.players === 'string' ? JSON.parse(team.players) : team.players;
      if (!Array.isArray(roster) || roster.some(player => typeof player?.id !== 'string'))
        throw new ScheduleError(409, `The roster for "${team.name}" needs an admin review. No games were imported.`);
      return roster.slice(0, 3).map(player => player.id);
    };
    const homeIds = players(home);
    const awayIds = players(away);
    const match: Match = {
      id: stableId('game:'+rowIndex), league: game.group, season, homeTeamId: home.id, awayTeamId: away.id,
      date: game.scheduledIsoDate, startTime: game.startTime, endTime: game.endTime,
      location: game.location, notes: game.notes, status: 'SCHEDULED', isComplete: false, is_practice: false,
      innings: Array.from({ length: 6 }, (_, i) => createEmptyInning(i + 1, homeIds, awayIds))
    };
    const conflict = scheduleConflict(match, matches);
    if (conflict && !allowConflicts) throw new ScheduleError(409, conflict);
    matches.push(match);
    plan.matchesToCreate.push(match);
    plan.summary.createdMatches++;
  }
  return plan;
};

/** Three bulk writes inside the caller's transaction: all records commit or none do. */
export const executeScheduleImport = async (client: PoolClient, plan: ImportPlan): Promise<void> => {
  if (plan.leaguesToCreate.length) await client.query(
    'INSERT INTO leagues (id, season) SELECT id, season FROM jsonb_to_recordset($1::jsonb) AS x(id text, season text)',
    [JSON.stringify(plan.leaguesToCreate)]
  );
  if (plan.teamsToCreate.length) await client.query(
    'INSERT INTO teams (id, name, league, season, players, subs) SELECT id, name, league, season, players, subs FROM jsonb_to_recordset($1::jsonb) AS x(id text, name text, league text, season text, players jsonb, subs jsonb)',
    [JSON.stringify(plan.teamsToCreate)]
  );
  if (plan.matchesToCreate.length) await client.query(
    `INSERT INTO matches (id, league, season, home_team_id, away_team_id, date, start_time, end_time, location, notes, status, is_complete, is_practice, innings)
     SELECT id, league, season, "homeTeamId", "awayTeamId", date, "startTime", "endTime", location, notes, 'SCHEDULED', false, false, innings
     FROM jsonb_to_recordset($1::jsonb) AS x(id text, league text, season text, "homeTeamId" text, "awayTeamId" text, date timestamptz, "startTime" text, "endTime" text, location text, notes text, innings jsonb)`,
    [JSON.stringify(plan.matchesToCreate)]
  );
};

/** A committed receipt makes a lost-response retry safe even after teams are renamed. */
export const importReceiptKey = (season: string, csvText: unknown, destinations: unknown): string => {
  if (typeof csvText !== 'string' || Buffer.byteLength(csvText, 'utf8') > 1_000_000 || !destinations || typeof destinations !== 'object' || Array.isArray(destinations))
    throw new ScheduleError(400, 'Choose a CSV smaller than 1 MB and map its league groups.');
  const mapping = Object.entries(destinations).sort(([a], [b]) => a.localeCompare(b))
    .map(([group, destination]) => [group, typeof (destination as ScheduleImportDestination)?.name === 'string' ? normalizeLeague((destination as ScheduleImportDestination).name) : '']);
  const digest = createHash('sha256').update(JSON.stringify([season, csvText.replace(/\r\n/g, '\n'), mapping])).digest('hex');
  return `schedule_import:${season}:${digest}`;
};

export const previousImport = async (client: PoolClient, key: string): Promise<ScheduleImportPreview | null> => {
  const result = await client.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  if (!result.rows[0]) return null;
  const saved: ScheduleImportPreview = JSON.parse(result.rows[0].value);
  return { games: saved.games.map(game => ({ ...game, duplicate: true })), summary: {
    totalRows: saved.summary.totalRows, createdMatches: 0, skippedDuplicates: saved.summary.totalRows,
    createdTeams: [], createdLeagues: [], errors: [], alreadyImported: true
  } };
};
