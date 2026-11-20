import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';
import { requireRole } from './auth.js';
import { withActiveSeason, ScheduleError, assertScheduleGamesUnlocked } from '../server/scheduleTransaction.js';
import { validateRosterChange } from '../server/teamRoster.js';
import { readIdentityLinks, readIdentityHistory, saveRosterIdentities, registerUnlinkedRosterPlayers } from '../server/playerIdentities.js';
import { mapTeamFromDB } from '../utils/dbMappers.js';
import { stableJson } from '../utils/scoringProtocol.js';
import { hasRecordedScores } from '../server/matchWritePolicy.js';
import { createEmptyInning } from '../utils/inningTemplate.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      if (req.query.identityDirectory === '1') {
        res.setHeader('Cache-Control', 'no-store');
        try { return res.status(200).json(await readIdentityLinks(pool)); }
        catch { return res.status(503).json({error:'Player history is unavailable. Please try again.'}); }
      }
      if (req.query.adminRoster === '1') {
        if (!requireRole(req, res, ['admin'])) return;
        const { season } = req.query;
        const active = await pool.query("SELECT value FROM app_settings WHERE key = 'current_season'");
        if (typeof season !== 'string' || season !== active.rows[0]?.value)
          throw new ScheduleError(409, 'The active season changed. Refresh the admin dashboard.');
        const [teams, leagues] = await Promise.all([
          pool.query('SELECT * FROM teams WHERE season = $1 ORDER BY name', [season]),
          pool.query('SELECT id, season FROM leagues WHERE season = $1 ORDER BY id', [season])
        ]);
        const [identityLinks, playerHistory] = await Promise.all([readIdentityLinks(pool), readIdentityHistory(pool, season)]);
        return res.status(200).json({ teams: teams.rows, leagues: leagues.rows, identityLinks, playerHistory });
      }
      const { league, season, ids } = req.query;
      let query = 'SELECT * FROM teams';
      const params: any[] = [];
      const conditions: string[] = [];
      const bind = (n: number) => String.fromCharCode(36) + n;
      if (ids !== undefined) {
        if (typeof ids !== 'string') return res.status(400).json({ error: 'Invalid team selection' });
        const teamIds = ids.split(',').map(id => id.trim()).filter(Boolean);
        if (teamIds.length === 0 || teamIds.length > 2 || teamIds.some(id => id.length > 128)) {
          return res.status(400).json({ error: 'Invalid team selection' });
        }
        params.push(teamIds);
        conditions.push('id = ANY(' + bind(params.length) + '::text[])');
      }
      if (league) {
        params.push(league);
        conditions.push('LOWER(league) = LOWER(' + bind(params.length) + ')');
      }
      if (season) {
        params.push(season);
        conditions.push(season === '2025'
          ? '(season = ' + bind(params.length) + ' OR season IS NULL)'
          : 'season = ' + bind(params.length));
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY name ASC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || '')) return res.status(405).json({ error: 'Method not allowed' });
    const role = requireRole(req, res, req.method === 'PUT' ? ['admin', 'umpire'] : ['admin']);
    if (!role) return;
    const body = req.body || {};
    const result = await withActiveSeason(body.season, async (client, season) => {
      if (req.method === 'POST') {
        const { id, name, league, players, subs = [] } = body;
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || typeof league !== 'string' || !Array.isArray(players) || !Array.isArray(subs))
          throw new ScheduleError(400, 'Enter a team name, league and valid roster.');
        const destination = await client.query('SELECT id FROM leagues WHERE LOWER(TRIM(id)) = LOWER(TRIM($1)) AND season = $2', [league, season]);
        if (destination.rows.length !== 1) throw new ScheduleError(400, 'Choose a league in the active season.');
        const canonical = destination.rows[0].id;
        if (body.action === 'create_team_roster') {
          if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new ScheduleError(400, 'Reload the new-team form and try again.');
          const roster = validateRosterChange({players:[],subs:[]}, {...body,expectedRoster:{players:[],subs:[]}});
          const existing = (await client.query('SELECT * FROM teams WHERE id=$1 FOR UPDATE',[id])).rows[0];
          if (existing) {
            const team = mapTeamFromDB(existing);
            if (team.season !== season || team.league !== canonical || team.name !== name.trim() ||
                stableJson({players:team.players,subs:team.subs || []}) !== stableJson(roster))
              throw new ScheduleError(409, 'This team was already created and has changed. Reload rosters before continuing.');
            const identityLinks = await readIdentityLinks(client);
            for (const [playerId,choice] of Object.entries(body.identityChoices || {})) {
              const link=identityLinks.find(link=>link.rosterPlayerId===playerId);
              if (!link || (choice === 'new' ? link.resolution !== 'new' : link.personId !== choice))
                throw new ScheduleError(409, 'This team was already created with a different player match. Reload rosters and edit the saved team.');
            }
            return {...existing,identityLinks};
          }
          const duplicate = await client.query('SELECT id FROM teams WHERE season=$1 AND LOWER(TRIM(league))=LOWER(TRIM($2)) AND LOWER(TRIM(name))=LOWER(TRIM($3))',[season,canonical,name]);
          if (duplicate.rows.length) throw new ScheduleError(409, 'This team already exists in the league. Select it in Rosters to set or edit its players.');
          await saveRosterIdentities(client,{id,name:name.trim(),league:canonical,season,players:[],subs:[]},roster,body.identityChoices,body.expectedIdentityLinks);
          const saved = (await client.query('INSERT INTO teams(id,name,league,players,subs,season) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
            [id,name.trim(),canonical,JSON.stringify(roster.players),JSON.stringify(roster.subs),season])).rows[0];
          return {...saved,identityLinks:await readIdentityLinks(client)};
        }
        const duplicate = await client.query('SELECT id FROM teams WHERE season = $1 AND LOWER(TRIM(league)) = LOWER(TRIM($2)) AND LOWER(TRIM(name)) = LOWER(TRIM($3))', [season, canonical, name]);
        if (duplicate.rows.length) throw new ScheduleError(409, 'A team with this name already exists in that league.');
        await registerUnlinkedRosterPlayers(client, {players,subs});
        return (await client.query('INSERT INTO teams (id, name, league, players, subs, season) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
          [id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name.trim(), canonical, JSON.stringify(players), JSON.stringify(subs), season])).rows[0];
      }
      if (req.method === 'PATCH') {
        const { action, teamIds, targetLeague } = body;
        if (action !== 'move_teams' || !Array.isArray(teamIds) || !teamIds.length || teamIds.length > 100 || teamIds.some(id => typeof id !== 'string') || typeof targetLeague !== 'string')
          throw new ScheduleError(400, 'Choose teams and a destination league.');
        const selected = await client.query('SELECT id, name FROM teams WHERE id = ANY($1::text[]) AND season = $2 FOR UPDATE', [teamIds, season]);
        if (selected.rows.length !== new Set(teamIds).size) throw new ScheduleError(403, 'Only teams in the active season can be moved.');
        const destination = await client.query('SELECT id FROM leagues WHERE LOWER(TRIM(id)) = LOWER(TRIM($1)) AND season = $2', [targetLeague, season]);
        if (destination.rows.length !== 1) throw new ScheduleError(400, 'Choose a league in the active season.');
        const existingNames = await client.query('SELECT name FROM teams WHERE season=$1 AND LOWER(TRIM(league))=LOWER(TRIM($2)) AND NOT (id=ANY($3::text[]))',[season,destination.rows[0].id,teamIds]);
        const names = new Set(existingNames.rows.map(team => team.name.trim().toLowerCase()));
        for (const team of selected.rows) {
          const name = team.name.trim().toLowerCase();
          if (names.has(name)) throw new ScheduleError(409, `${team.name} already exists in ${destination.rows[0].id}. Rename one team before moving it.`);
          names.add(name);
        }
        const games = await client.query('SELECT id, home_team_id, away_team_id, status, is_complete, innings, tie_breaker FROM matches WHERE home_team_id = ANY($1::text[]) OR away_team_id = ANY($1::text[]) FOR UPDATE', [teamIds]);
        await assertScheduleGamesUnlocked(client, games.rows);
        const selectedIds = new Set(teamIds);
        const otherIds = [...new Set(games.rows.flatMap(game => [game.home_team_id, game.away_team_id]))].filter(id => !selectedIds.has(id));
        if (otherIds.length) {
          const opponents = await client.query('SELECT id, league, season FROM teams WHERE id = ANY($1::text[])', [otherIds]);
          if (opponents.rows.length !== otherIds.length || opponents.rows.some(team => team.season !== season || team.league.trim().toLowerCase() !== destination.rows[0].id.trim().toLowerCase()))
            throw new ScheduleError(409, 'These teams have scheduled opponents in another league. Move both teams together, or adjust their unplayed games first.');
        }
        await client.query('UPDATE teams SET league = $1 WHERE id = ANY($2::text[]) AND season = $3', [destination.rows[0].id, teamIds, season]);
        await client.query('UPDATE matches SET league = $1, revision = revision + 1 WHERE (home_team_id = ANY($2::text[]) OR away_team_id = ANY($2::text[])) AND season = $3', [destination.rows[0].id, teamIds, season]);
        return { success: true };
      }
      const id = req.method === 'DELETE' ? req.query.id : body.id;
      if (typeof id !== 'string') throw new ScheduleError(400, 'Choose a team first.');
      const found = await client.query('SELECT id, name, league, season, players, subs FROM teams WHERE id = $1 FOR UPDATE', [id]);
      const current = found.rows[0];
      if (!current) throw new ScheduleError(404, 'Team not found.');
      if (current.season !== season) throw new ScheduleError(403, 'Archived teams are preserved. Only the active season can be changed.');
      if (req.method === 'PUT' && body.action === 'update_roster') {
        if (role !== 'admin') throw new ScheduleError(403, 'Only an admin can change team rosters.');
        const roster = validateRosterChange(current, body);
        // Lock the games before inspecting scoring ownership, so opening a game
        // cannot slip between this check and the roster commit.
        const games = await client.query(`SELECT id, status, is_complete, is_practice, innings, tie_breaker, home_team_id, away_team_id FROM matches
          WHERE (home_team_id = $1 OR away_team_id = $1) AND season = $2
          ORDER BY id FOR UPDATE`, [id, season]);
        const unfinished = games.rows.filter(game => !game.is_complete && game.status !== 'FINAL');
        if (unfinished.some(game => game.status === 'IN_PROGRESS'))
          throw new ScheduleError(409, 'This team has a game in progress. Finish the game before changing its roster.');
        if (unfinished.length) {
          const locks = await client.query('SELECT match_id FROM scoring_locks WHERE match_id = ANY($1::text[])', [unfinished.map(game => String(game.id))]);
          if (locks.rows.length) throw new ScheduleError(409, 'An umpire has this team open for scoring. Close scoring before changing the roster.');
        }
        await saveRosterIdentities(client, mapTeamFromDB(current), roster, body.identityChoices, body.expectedIdentityLinks);
        const saved = (await client.query('UPDATE teams SET players = $2, subs = $3 WHERE id = $1 RETURNING *',
          [id, JSON.stringify(roster.players), JSON.stringify(roster.subs)])).rows[0];
        // Initialize only empty, unplayed lineup templates created by schedule import.
        // Explicit attendance choices and every recorded pitch remain untouched.
        for (const game of games.rows) {
          const side = game.home_team_id === id ? 'home' : 'away';
          const innings = typeof game.innings === 'string' ? JSON.parse(game.innings) : game.innings;
          if (game.status !== 'SCHEDULED' || game.is_complete || game.is_practice || hasRecordedScores(innings,game.tie_breaker) ||
              !Array.isArray(innings) || !innings.length || innings.some(inning => (inning[side]?.playerScores || []).length)) continue;
          const updated = innings.map(inning => createEmptyInning(inning.number,
            side === 'home' ? roster.players.map(player=>player.id) : (inning.home?.playerScores || []).map((player:any)=>player.playerId),
            side === 'away' ? roster.players.map(player=>player.id) : (inning.away?.playerScores || []).map((player:any)=>player.playerId)));
          await client.query('UPDATE matches SET innings=$2,revision=revision+1 WHERE id=$1',[game.id,JSON.stringify(updated)]);
        }
        return {...saved, identityLinks: await readIdentityLinks(client)};
      }
      if (req.method === 'DELETE') {
        const games = await client.query('SELECT id FROM matches WHERE home_team_id = $1 OR away_team_id = $1 LIMIT 1', [id]);
        if (games.rows.length) throw new ScheduleError(409, 'This team has games on the schedule. Keep it, or remove its unplayed games first.');
        await client.query('DELETE FROM teams WHERE id = $1 AND season = $2', [id, season]);
        return { success: true };
      }
      const { name, players, subs } = body;
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || !Array.isArray(players) || !Array.isArray(subs))
        throw new ScheduleError(400, 'Enter a team name and valid roster.');
      if (role === 'umpire') {
        const storedPlayers = typeof current.players === 'string' ? JSON.parse(current.players) : current.players;
        const storedSubs = typeof current.subs === 'string' ? JSON.parse(current.subs) : (current.subs || []);
        const samePlayers = JSON.stringify(players) === JSON.stringify(storedPlayers);
        const existingSubsIntact = storedSubs.every((existing: unknown) => subs.some((submitted: unknown) => JSON.stringify(submitted) === JSON.stringify(existing)));
        const uniqueSubIds = new Set(subs.map((sub: any) => sub?.id)).size === subs.length;
        if (name !== current.name || !samePlayers || !existingSubsIntact || !uniqueSubIds)
          throw new ScheduleError(403, 'Umpires may only add substitutes; permanent roster changes require an admin.');
        await registerUnlinkedRosterPlayers(client, {players,subs}, new Set([...storedPlayers, ...storedSubs].map(p => p.id)));
        return (await client.query('UPDATE teams SET subs = $2 WHERE id = $1 RETURNING *', [id, JSON.stringify(subs)])).rows[0];
      }
      const duplicates = await client.query('SELECT id FROM teams WHERE season = $1 AND LOWER(TRIM(league)) = LOWER(TRIM($2)) AND LOWER(TRIM(name)) = LOWER(TRIM($3)) AND id <> $4', [season, current.league, name, id]);
      if (duplicates.rows.length) throw new ScheduleError(409, 'A team with this name already exists in that league.');
      const previousTeam = mapTeamFromDB(current);
      const submittedIds = [...players,...subs].map(player => player?.id);
      if (new Set(submittedIds).size !== submittedIds.length)
        throw new ScheduleError(400, 'Each player can appear only once on this roster.');
      if ([...previousTeam.players,...(previousTeam.subs || [])].some(player => !submittedIds.includes(player.id)))
        throw new ScheduleError(409, 'Keep existing players to protect their game history. Use Admin Dashboard → Rosters to move them to substitutes.');
      await registerUnlinkedRosterPlayers(client, {players,subs}, new Set([...previousTeam.players, ...(previousTeam.subs || [])].map(p => p.id)));
      return (await client.query('UPDATE teams SET name = $2, players = $3, subs = $4 WHERE id = $1 RETURNING *', [id, name.trim(), JSON.stringify(players), JSON.stringify(subs)])).rows[0];
    });
    return res.status(req.method === 'POST' ? 201 : 200).json(result);
  } catch (error) {
    if (error instanceof ScheduleError) return res.status(error.status).json({ error: error.message });
    console.error('[teams]', error);
    return res.status(500).json({ error: 'No changes were saved. Refresh and try again.' });
  }
}
