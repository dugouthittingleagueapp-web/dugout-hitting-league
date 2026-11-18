import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Player, Team } from '../types.js';
import { ARCHIVE_2025_TEAMS } from '../services/archive2025Data.js';
import { mapTeamFromDB } from '../utils/dbMappers.js';
import { priorPlayerCandidates, type PlayerIdentityCandidate, type PlayerIdentityLink } from '../utils/playerIdentity.js';
import { ScheduleError } from './scheduleTransaction.js';

type Reader = Pick<PoolClient, 'query'>;
export const registerUnlinkedRosterPlayers = async (db: PoolClient, roster: {players: Player[]; subs?: Player[]}, knownIds: Set<string> = new Set()) => {
  const rosterIds = new Set<string>();
  for (const player of [...roster.players, ...(roster.subs || [])]) {
    if (!player || typeof player.id !== 'string' || !player.id.trim() || player.id.length > 128 ||
        typeof player.name !== 'string' || !player.name.trim() || player.name.trim().length > 80 ||
        (player.lastName != null && (typeof player.lastName !== 'string' || player.lastName.length > 80)))
      throw new ScheduleError(400, 'Enter a valid name for every player before saving.');
    if (rosterIds.has(player.id)) throw new ScheduleError(400, 'Each player can appear only once on this roster.');
    rosterIds.add(player.id);
    const existing = await db.query('SELECT player_id FROM player_identity_links WHERE roster_player_id=$1', [player.id]);
    if (existing.rows.length) {
      if (!knownIds.has(player.id)) throw new ScheduleError(409, 'This player entry belongs to another roster. Add a new entry and confirm the previous-player match in Admin Rosters.');
      continue;
    }
    const personId = randomUUID();
    await db.query('INSERT INTO league_players(id,name,last_name) VALUES($1,$2,$3)', [personId,player.name,player.lastName || '']);
    await db.query("INSERT INTO player_identity_links(roster_player_id,player_id,resolution) VALUES($1,$2,'unreviewed')", [player.id,personId]);
  }
};
export const readIdentityLinks = async (db: Reader): Promise<PlayerIdentityLink[]> => {
  const rows = await db.query('SELECT roster_player_id, player_id, resolution FROM player_identity_links');
  return rows.rows.map(row => ({ rosterPlayerId: row.roster_player_id, personId: row.player_id, resolution: row.resolution }));
};
export const readIdentityHistory = async (db: Reader, season: string): Promise<PlayerIdentityCandidate[]> => {
  const [stored, links, people] = await Promise.all([
    db.query('SELECT * FROM teams WHERE season < $1', [season]), readIdentityLinks(db),
    db.query('SELECT id, name, last_name FROM league_players')
  ]);
  const teams = [...stored.rows.map(mapTeamFromDB), ...ARCHIVE_2025_TEAMS.filter(t => t.season < season && !stored.rows.some(row => row.id === t.id))];
  const result = new Map<string, PlayerIdentityCandidate>();
  for (const team of teams) for (const player of [...team.players, ...(team.subs || [])]) {
    const link = links.find(link => link.rosterPlayerId === player.id); if (!link) continue;
    const person = people.rows.find(row => row.id === link.personId); if (!person) continue;
    const candidate: PlayerIdentityCandidate = result.get(person.id) || { personId: person.id, name: person.name, lastName: person.last_name, teams: [], aliases: [] };
    candidate.aliases!.push({name:player.name,lastName:player.lastName});
    if (!candidate.teams.some(t => t.teamName === team.name && t.season === team.season)) candidate.teams.push({ teamName: team.name, season: team.season });
    result.set(person.id, candidate);
  }
  return [...result.values()];
};

/** Participates in the roster transaction. Scoring IDs and historic rows never change. */
export const saveRosterIdentities = async (db: PoolClient, team: Team, roster: { players: Player[]; subs: Player[] }, choices: unknown, expectedLinks?: Record<string, string | null>) => {
  const links = await readIdentityLinks(db), history = await readIdentityHistory(db, team.season);
  if (choices !== undefined && (!choices || typeof choices !== 'object' || Array.isArray(choices))) throw new ScheduleError(400, 'Check the player matches before saving.');
  const decisions = (choices || {}) as Record<string, unknown>;
  const selectedPeople = new Set<string>();
  for (const player of [...roster.players, ...roster.subs]) {
    const stored = links.find(link => link.rosterPlayerId === player.id);
    // New roster IDs cannot borrow another existing player's entry to bypass confirmation.
    if (stored && ![...team.players, ...(team.subs || [])].some(p => p.id === player.id)) throw new ScheduleError(409, 'This roster entry already belongs to another player. Reload and add the player again.');
    const candidates = priorPlayerCandidates(player, team.season, history, stored?.personId);
    const decision = decisions[player.id];
    if (expectedLinks && Object.prototype.hasOwnProperty.call(expectedLinks, player.id) && expectedLinks[player.id] !== (stored?.personId || null))
      throw new ScheduleError(409, 'This player match changed on another screen. Reload rosters before saving.');
    let personId = stored?.personId;
    let resolution = stored?.resolution;
    if (resolution === 'unreviewed' && !candidates.length) resolution = 'new';
    if (decision !== undefined) {
      if (stored && expectedLinks?.[player.id] !== stored.personId) throw new ScheduleError(409, 'Reload the current player match before changing it.');
      if (decision !== 'new') {
        if (typeof decision !== 'string' || !history.some(candidate => candidate.personId === decision && candidate.personId !== stored?.personId)) throw new ScheduleError(400, 'Choose a player from a previous season, or confirm this is a different player.');
        personId = decision; resolution = 'confirmed';
      } else {
        if (stored && links.filter(link => link.personId === stored.personId).length > 1) personId = undefined;
        resolution = 'new';
      }
    } else if ((!stored || stored.resolution === 'unreviewed') && candidates.length) {
      throw new ScheduleError(409, `Check the previous-season match for ${player.name} before saving.`);
    }
    if (!personId) {
      personId = randomUUID(); resolution = 'new';
      await db.query('INSERT INTO league_players(id,name,last_name) VALUES($1,$2,$3)', [personId, player.name, player.lastName || '']);
    }
    if (selectedPeople.has(personId)) throw new ScheduleError(400, 'The same player cannot appear twice on this roster.');
    selectedPeople.add(personId);
    const previous = [...team.players, ...(team.subs || [])].find(p => p.id === player.id);
    const nameChanged = previous && (previous.name !== player.name || (previous.lastName || '') !== (player.lastName || ''));
    // Registering a returning player with initials/first name alone must not
    // erase the fuller permanent name. Only an actual existing-name edit changes it.
    if (stored && nameChanged && (decision === undefined || decision === 'new'))
      await db.query(`UPDATE league_players SET name=CASE WHEN $4 THEN $2 ELSE name END,
        last_name=CASE WHEN $5 THEN $3 ELSE last_name END WHERE id=$1`,
        [personId, player.name, player.lastName || '', previous!.name !== player.name,
          (previous!.lastName || '') !== (player.lastName || '')]);
    await db.query(`INSERT INTO player_identity_links(roster_player_id,player_id,resolution) VALUES($1,$2,$3)
      ON CONFLICT(roster_player_id) DO UPDATE SET player_id=EXCLUDED.player_id,resolution=EXCLUDED.resolution`, [player.id, personId, resolution || 'new']);
  }
};
