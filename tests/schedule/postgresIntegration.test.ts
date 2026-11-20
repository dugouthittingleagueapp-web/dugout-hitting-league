import {identityReleaseSql} from '../../scripts/player-identity-release-plan';
import {planPlayerIdentities} from '../../utils/playerIdentity';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {randomUUID} from 'node:crypto';
import { signSessionToken } from '../../api/auth';

// Opt in only to a disposable LOCAL database. Never use DATABASE_URL or a Neon URL.
vi.mock('../../api/db.js', async () => {
  const { Pool } = await import('pg');
  const connectionString = process.env.DUGOUT_TEST_DATABASE_URL || 'postgres://unused@127.0.0.1:65432/dugout_test_unused';
  const url = new URL(connectionString);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/dugout_test_'))
    throw new Error('Integration tests require a disposable localhost database named dugout_test_*.');
  const schema = `dugout_schedule_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString, max: 10, options: `-c search_path=${schema}` });
  return { default: Object.assign(pool, { testSchema: schema }) };
});
import pool from '../../api/db';
import schedule from '../../api/schedule-admin';
import leagues from '../../api/leagues';
import teams from '../../api/teams';
import matches from '../../api/matches';
import scoringLock from '../../api/scoring-lock';
import { mapMatchFromDB, mapTeamFromDB } from '../../utils/dbMappers';
import { calculateLeagueStandings } from '../../utils/leagueStandings';

const csv = (rows: string[]) => ['Date,Start Time,End Time,Location,Group,Home Team,Away Team,Notes', ...rows].join('\n');
const file = csv(['2027-11-01,6:00 pm,7:00 pm,Tunnels 5/6,CSV Group,Eagles,Panthers,Bring balls']);
const payload = { action: 'import_schedule', season: '2027', csvText: file, leagueDestinations: { 'CSV Group': { mode: 'new', name: '11U' } } };
const request = async (handler: any, method: string, body: any = {}, query: any = {}, role: 'admin' | 'umpire' | null = 'admin') => {
  const res: any = { statusCode: 200 };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (data: unknown) => { res.body = JSON.parse(JSON.stringify(data)); return res; };
  res.setHeader = vi.fn();
  await handler({ method, body, query, headers: role ? { authorization: `Bearer ${signSessionToken(role)}` } : {} }, res);
  return res;
};
const counts = async () => (await pool.query('SELECT (SELECT COUNT(*)::int FROM leagues) AS leagues, (SELECT COUNT(*)::int FROM teams) AS teams, (SELECT COUNT(*)::int FROM matches) AS matches')).rows[0];
const importFile = async (readyRosters = false) => {
  const result = await request(schedule, 'POST', payload);
  if (readyRosters) for (const team of (await pool.query('SELECT * FROM teams')).rows) {
    if (team.players.length) continue;
    const players=Array.from({length:3},(_,i)=>({id:`${team.id}-actual-${i}`,name:`Actual ${i+1}`,lastName:team.name}));
    expect((await request(teams,'PUT',{action:'update_roster',id:team.id,season:'2027',expectedRoster:{players:[],subs:[]},players,subs:[]})).statusCode).toBe(200);
  }
  return result;
};

describe.skipIf(!process.env.DUGOUT_TEST_DATABASE_URL)('Schedule workflows on disposable local PostgreSQL', () => {
  beforeAll(async () => {
    vi.stubEnv('SESSION_SECRET', 'disposable-local-integration-test-session-secret');
    await pool.query(`CREATE SCHEMA ${(pool as any).testSchema}`);
    await pool.query(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
    await pool.query(readFileSync(new URL('../../migrations/player-identities.sql', import.meta.url), 'utf8'));
    await pool.query(`ALTER TABLE matches ADD COLUMN revision BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN is_forfeit BOOLEAN DEFAULT FALSE, ADD COLUMN forfeiting_team_id TEXT,
      ADD COLUMN forfeit_reason TEXT, ADD COLUMN winning_team_id TEXT,
      ADD CONSTRAINT synthetic_failure CHECK (notes IS DISTINCT FROM 'fail-insert');
      CREATE TABLE scoring_locks (match_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());`);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE leagues, teams, matches, app_settings, scoring_locks, player_identity_links, league_players');
    await pool.query("INSERT INTO app_settings VALUES ('current_season', '2027')");
  });
  afterAll(async () => { await pool.end(); vi.unstubAllEnvs(); });

  it('preflights without writing and imports all league/team/game records together', async () => {
    const preview = await request(schedule, 'POST', { ...payload, action: 'preview_import' });
    expect(preview.statusCode).toBe(200);
    expect(preview.body.summary.createdMatches).toBe(1);
    expect(await counts()).toEqual({ leagues: 0, teams: 0, matches: 0 });
    expect((await importFile()).body).toMatchObject({ createdMatches: 1, skippedDuplicates: 0, createdLeagues: ['11U'] });
    expect(await counts()).toEqual({ leagues: 1, teams: 2, matches: 1 });
  });

  it('retries safely after a lost response, even if the teams were renamed afterward', async () => {
    await importFile();
    const team = (await pool.query("SELECT id FROM teams WHERE name = 'Eagles'")).rows[0];
    expect((await request(schedule, 'PATCH', { action: 'rename_team', season: '2027', id: team.id, teamName: 'Golden Eagles' })).statusCode).toBe(200);
    const retry = await importFile();
    expect(retry.body).toMatchObject({ alreadyImported: true, createdMatches: 0, skippedDuplicates: 1 });
    expect(await counts()).toEqual({ leagues: 1, teams: 2, matches: 1 });
    expect((await pool.query('SELECT name FROM teams WHERE id = $1', [team.id])).rows[0].name).toBe('Golden Eagles');
  });

  it('serializes simultaneous imports and creates only one copy', async () => {
    const results = await Promise.all([importFile(), importFile()]);
    expect(results.every(result => result.statusCode === 200)).toBe(true);
    expect(results.reduce((sum, result) => sum + result.body.createdMatches, 0)).toBe(1);
    expect(await counts()).toEqual({ leagues: 1, teams: 2, matches: 1 });
  });

  it('rolls back leagues, teams, games and receipt if the final insert fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await request(schedule, 'POST', { ...payload, csvText: file.replace('Bring balls', 'fail-insert') });
    spy.mockRestore();
    expect(result.statusCode).toBe(500);
    expect(await counts()).toEqual({ leagues: 0, teams: 0, matches: 0 });
    expect((await pool.query("SELECT key FROM app_settings WHERE key LIKE 'schedule_import:%'")).rows).toEqual([]);
  });

  it('validates every row before writing any valid rows', async () => {
    const result = await request(schedule, 'POST', { ...payload, csvText: file + '\n2027-02-30,6:00 pm,7:00 pm,Tunnels 5/6,CSV Group,A,B,' });
    expect(result.statusCode).toBe(400);
    expect(await counts()).toEqual({ leagues: 0, teams: 0, matches: 0 });
  });

  it('checks duplicates against the selected destination, ignoring CSV group aliases', async () => {
    await importFile();
    const result = await request(schedule, 'POST', { ...payload, action: 'preview_import', csvText: file.replace('CSV Group', 'Different Group'),
      leagueDestinations: { 'Different Group': { mode: 'existing', name: '11U' } } });
    expect(result.statusCode).toBe(200);
    expect(result.body.games[0]).toMatchObject({ group: '11U', duplicate: true });
    expect(result.body.summary).toMatchObject({ createdMatches: 0, skippedDuplicates: 1 });
  });

  it('rejects archived writes through import and the older create/delete APIs', async () => {
    for (const [handler, method, body, query] of [
      [schedule, 'POST', { ...payload, season: '2025' }, {}],
      [leagues, 'POST', { id: '11U', season: '2025' }, {}],
      [leagues, 'DELETE', {}, { id: '11U', season: '2025' }],
      [teams, 'POST', { name: 'A', league: '11U', players: [], season: '2025' }, {}],
      [matches, 'POST', { id: 'g', league: '11U', homeTeamId: 'a', awayTeamId: 'b', season: '2025' }, {}]
    ] as const) expect((await request(handler, method, body, query)).statusCode).toBe(403);
    expect(await counts()).toEqual({ leagues: 0, teams: 0, matches: 0 });
  });

  it('rejects unauthenticated and umpire schedule changes before any writes', async () => {
    expect((await request(schedule, 'POST', payload, {}, null)).statusCode).toBe(401);
    expect((await request(schedule, 'POST', payload, {}, 'umpire')).statusCode).toBe(403);
    expect(await counts()).toEqual({ leagues: 0, teams: 0, matches: 0 });
  });

  it.each([0, '0'])('protects scored legacy SCHEDULED games from edit, removal and league deletion: %s', async points => {
    await importFile(true);
    const game = (await pool.query('SELECT * FROM matches')).rows[0];
    game.innings[0].home.playerScores[0].pitches[0].points = points;
    await pool.query('UPDATE matches SET innings = $1 WHERE id = $2', [JSON.stringify(game.innings), game.id]);
    const before = JSON.stringify((await pool.query('SELECT * FROM matches')).rows);
    expect((await request(schedule, 'PATCH', { action: 'delete_game', season: '2027', id: game.id })).statusCode).toBe(409);
    expect((await request(schedule, 'PATCH', { action: 'update_game', season: '2027', id: game.id })).statusCode).toBe(409);
    expect((await request(leagues, 'DELETE', {}, { id: '11U', season: '2027' })).statusCode).toBe(409);
    expect(JSON.stringify((await pool.query('SELECT * FROM matches')).rows)).toBe(before);
  });

  it('preserves notes on edit and refresh and refuses a stale revision', async () => {
    await importFile();
    const data = (await request(schedule, 'GET', {}, { season: '2027' })).body;
    const game = mapMatchFromDB(data.matches[0]);
    const draft = { action: 'update_game', season: '2027', id: game.id, revision: game.revision, date: '2027-11-02', startTime: '6:00 pm', endTime: '7:00 pm', location: game.location, notes: game.notes, homeTeamId: game.homeTeamId, awayTeamId: game.awayTeamId };
    expect((await request(schedule, 'PATCH', draft)).statusCode).toBe(200);
    expect((await request(schedule, 'PATCH', draft)).statusCode).toBe(409);
    const refreshed = (await request(schedule, 'GET', {}, { season: '2027' })).body;
    expect(mapMatchFromDB(refreshed.matches[0])).toMatchObject({ notes: 'Bring balls', date: expect.stringContaining('2027-11-02') });
  });

  it('resolves simultaneous duplicate team renames without changing rosters or references', async () => {
    await importFile();
    const rosterBefore = (await pool.query('SELECT id, players, subs FROM teams ORDER BY id')).rows;
    const requests = rosterBefore.map(team => request(schedule, 'PATCH', { action: 'rename_team', season: '2027', id: team.id, teamName: 'New Name' }));
    const results = await Promise.all(requests);
    expect(results.map(result => result.statusCode).sort()).toEqual([200, 409]);
    expect((await pool.query('SELECT id, players, subs FROM teams ORDER BY id')).rows).toEqual(rosterBefore);
    const game = (await pool.query('SELECT * FROM matches')).rows[0];
    expect(rosterBefore.map(team => team.id)).toContain(game.home_team_id);
    expect(rosterBefore.map(team => team.id)).toContain(game.away_team_id);
  });

  it('preserves finished results, stats and practice classification during unrelated schedule work', async () => {
    await importFile(true);
    const original = (await pool.query('SELECT * FROM matches')).rows[0];
    original.innings[0].home.playerScores[0].pitches[0].points = 4;
    await pool.query("UPDATE matches SET innings = $1, is_complete = true, status = 'FINAL' WHERE id = $2", [JSON.stringify(original.innings), original.id]);
    const getStats = async () => {
      const games = (await pool.query('SELECT * FROM matches')).rows.map(mapMatchFromDB);
      const roster = (await pool.query('SELECT * FROM teams')).rows.map(mapTeamFromDB);
      return calculateLeagueStandings(games, roster, '11U');
    };
    const stats = await getStats();
    const before = JSON.stringify((await pool.query('SELECT * FROM matches WHERE id = $1', [original.id])).rows[0]);
    expect((await request(schedule, 'POST', { ...payload, csvText: file.replace('2027-11-01', '2027-11-08') })).statusCode).toBe(200);
    expect(JSON.stringify((await pool.query('SELECT * FROM matches WHERE id = $1', [original.id])).rows[0])).toBe(before);
    expect(await getStats()).toEqual(stats);
  });

  it('allows only one of starting a game or deleting its league, leaving no orphaned records', async () => {
    await importFile();
    await pool.query('DELETE FROM matches'); // Only synthetic local data.
    const roster = (await pool.query('SELECT id FROM teams')).rows;
    const results = await Promise.all([
      request(matches, 'POST', { id: 'concurrent-game', season: '2027', league: '11U', homeTeamId: roster[0].id, awayTeamId: roster[1].id, status: 'IN_PROGRESS', innings: [] }),
      request(leagues, 'DELETE', {}, { id: '11U', season: '2027' })
    ]);
    expect(results[0].statusCode === 201 ? results[1].statusCode === 409 : results[1].statusCode === 200).toBe(true);
    const orphaned = await pool.query('SELECT m.id FROM matches m LEFT JOIN teams h ON m.home_team_id = h.id LEFT JOIN teams a ON m.away_team_id = a.id WHERE h.id IS NULL OR a.id IS NULL');
    expect(orphaned.rows).toEqual([]);
  });
  it('maps multiple CSV groups and skips repeated rows within a file without creating extra teams', async () => {
    await importFile();
    const csvText = csv([
      '2027-11-01,6:00 pm,7:00 pm,Tunnels 5/6,Alias,Eagles,Panthers,',
      '2027-11-01,6:00 pm,7:00 pm,Tunnels 7/8,New Group,Wolves,Raptors,',
      '2027-11-01,6:00 pm,7:00 pm,Tunnels 7/8,New Group,Raptors,Wolves,'
    ]);
    const result = await request(schedule, 'POST', { ...payload, csvText, leagueDestinations: {
      Alias: { mode: 'existing', name: '11U' }, 'New Group': { mode: 'new', name: '12U' }
    } });
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ createdMatches: 1, skippedDuplicates: 2, createdLeagues: ['12U'] });
    expect(await counts()).toEqual({ leagues: 2, teams: 4, matches: 2 });
  });

  it('keeps score writes and stale offline snapshots protected after schedule operations', async () => {
    await importFile(true);
    const game = mapMatchFromDB((await pool.query('SELECT * FROM matches')).rows[0]);
    const token = '11111111-1111-4111-8111-111111111111';
    expect((await request(scoringLock, 'POST', { matchId: game.id, token, action: 'acquire' }, {}, 'umpire')).statusCode).toBe(200);
    const scored = JSON.parse(JSON.stringify(game));
    scored.innings[0].home.playerScores[0].pitches[0].points = 4;
    const scoreRequest = async (body: unknown) => {
      const res: any = { statusCode: 200 };
      res.status = (code: number) => { res.statusCode = code; return res; };
      res.json = (body: unknown) => { res.body = body; return res; };
      await matches({ method: 'PUT', body, query: {}, headers: { authorization: `Bearer ${signSessionToken('umpire')}`, 'x-scoring-token': token } } as any, res);
      return res;
    };
    expect((await scoreRequest({ ...scored, status: 'IN_PROGRESS' })).statusCode).toBe(200);
    expect((await scoreRequest(game)).statusCode).toBe(409);
    expect((await request(schedule, 'PATCH', { action: 'delete_game', id: game.id, season: '2027' })).statusCode).toBe(409);
    const stored = (await pool.query('SELECT innings FROM matches WHERE id = $1', [game.id])).rows[0];
    expect(stored.innings[0].home.playerScores[0].pitches[0].points).toBe(4);
  });

  it('protects a blank game an umpire has open before its first pitch arrives', async () => {
    await importFile();
    const game = (await pool.query('SELECT * FROM matches')).rows[0];
    const token = '22222222-2222-4222-8222-222222222222';
    expect((await request(scoringLock, 'POST', { matchId: game.id, token, action: 'acquire' }, {}, 'umpire')).statusCode).toBe(200);
    const snapshot = (await request(schedule, 'GET', {}, { season: '2027' })).body;
    expect(mapMatchFromDB(snapshot.matches[0]).scoringLocked).toBe(true);
    expect((await request(schedule, 'PATCH', { action: 'delete_game', season: '2027', id: game.id })).statusCode).toBe(409);
    expect((await request(leagues, 'DELETE', {}, { id: '11U', season: '2027' })).statusCode).toBe(409);
    expect(await counts()).toEqual({ leagues: 1, teams: 2, matches: 1 });
  });

  it('moves scheduled opponents together instead of leaving cross-league references', async () => {
    await importFile();
    await request(leagues, 'POST', { id: '12U', season: '2027' });
    const ids = (await pool.query('SELECT id FROM teams')).rows.map(team => team.id);
    expect((await request(teams, 'PATCH', { action: 'move_teams', teamIds: [ids[0]], targetLeague: '12U' })).statusCode).toBe(409);
    expect((await pool.query('SELECT league FROM matches')).rows[0].league).toBe('11U');
    expect((await request(teams, 'PATCH', { action: 'move_teams', teamIds: ids, targetLeague: '12U' })).statusCode).toBe(200);
    expect((await pool.query('SELECT league, revision FROM matches')).rows[0]).toMatchObject({ league: '12U', revision: '1' });
  });

  const rosterTeam = async (count = 3) => {
    await importFile();
    const team = (await pool.query("SELECT * FROM teams WHERE name='Eagles'")).rows[0];
    const players = Array.from({ length: count }, (_, i) => ({ id: `roster-player-${i}`, name: `Player ${i + 1}`, lastName: 'Test' }));
    expect((await request(teams,'PUT',{action:'update_roster',id:team.id,season:'2027',expectedRoster:{players:[],subs:[]},players,subs:[{id:'roster-sub',name:'Sub',lastName:'Test'}]})).statusCode).toBe(200);
    return (await pool.query('SELECT * FROM teams WHERE id=$1', [team.id])).rows[0];
  };
  const rosterBody = (team: any) => ({action:'update_roster',id:team.id,season:'2027',
    expectedRoster:{players:team.players,subs:team.subs},players:team.players,subs:team.subs});
  const gameRows = async () => (await pool.query('SELECT * FROM matches ORDER BY id')).rows;

  it('loads active-season rosters only for admins', async () => {
    await rosterTeam();
    for (const role of [null, 'umpire'] as const) expect((await request(teams, 'GET', {}, {adminRoster:'1',season:'2027'}, role)).statusCode).toBe(role ? 403 : 401);
    const result = await request(teams, 'GET', {}, {adminRoster:'1',season:'2027'});
    expect(result.statusCode).toBe(200); expect(result.body.teams).toHaveLength(2);
    expect((await request(teams, 'GET', {}, {adminRoster:'1',season:'2026'})).statusCode).toBe(409);
  });

  it('edits names and adds substitutes without changing game lineups, scores or status', async () => {
    const team = await rosterTeam(), before = await gameRows();
    const body = rosterBody(team); body.players = body.players.map((p: any, i: number) => i === 0 ? {...p,name:'Corrected'} : p);
    body.subs = [...body.subs, {id:'new-sub',name:'New',lastName:'Player'}];
    const result = await request(teams, 'PUT', body);
    expect(result.statusCode).toBe(200); expect(result.body.players[0]).toMatchObject({id:'roster-player-0',name:'Corrected'});
    expect(await gameRows()).toEqual(before);
  });

  it('keeps player identities when moving between the regular roster and substitutes', async () => {
    const team = await rosterTeam();
    const body = {...rosterBody(team),players:[...team.players.slice(0,2),team.subs[0]],subs:[team.players[2]]};
    expect((await request(teams,'PUT',body)).statusCode).toBe(200);
    const saved = (await pool.query('SELECT * FROM teams WHERE id=$1',[team.id])).rows[0];
    expect(saved.players.map((p:any)=>p.id)).toEqual(['roster-player-0','roster-player-1','roster-sub']);
    expect(saved.subs[0].id).toBe('roster-player-2');
  });

  it('adds a third regular player to a two-player roster without replacing existing IDs', async () => {
    const team = await rosterTeam(2);
    const result = await request(teams,'PUT',{...rosterBody(team),players:[...team.players,{id:'third',name:'Third'}]});
    expect(result.statusCode).toBe(200);expect(result.body.players.map((p:any)=>p.id)).toEqual(['roster-player-0','roster-player-1','third']);
  });

  it.each(['erase', 'duplicate', 'blank', 'too-many', 'bad-last-name'])('rejects invalid roster %s without changing saved records', async kind => {
    const team = await rosterTeam();const body=rosterBody(team);
    if(kind==='erase') body.players=team.players.slice(0,2);
    if(kind==='duplicate') body.subs=[team.players[0]];
    if(kind==='blank') body.players=[{...team.players[0],name:'  '},...team.players.slice(1)];
    if(kind==='too-many') body.players=[...team.players,{id:'extra',name:'Extra'}];
    if(kind==='bad-last-name') body.players=[{...team.players[0],lastName:{}},...team.players.slice(1)];
    expect([400,409]).toContain((await request(teams,'PUT',body)).statusCode);
    expect((await pool.query('SELECT * FROM teams WHERE id=$1',[team.id])).rows[0]).toEqual(team);
  });

  it('rejects a missing or stale source roster and serializes concurrent admin edits', async () => {
    const team=await rosterTeam();
    expect((await request(teams,'PUT',{...rosterBody(team),expectedRoster:undefined})).statusCode).toBe(409);
    const responses=await Promise.all(['First','Second'].map(name=>request(teams,'PUT',{...rosterBody(team),players:[{...team.players[0],name},...team.players.slice(1)]})));
    expect(responses.map(r=>r.statusCode).sort()).toEqual([200,409]);
    const saved=(await pool.query('SELECT * FROM teams WHERE id=$1',[team.id])).rows[0];
    expect(['First','Second']).toContain(saved.players[0].name);
    expect(saved.players.slice(1)).toEqual(team.players.slice(1));
  });

  it('blocks roster edits during an in-progress game or acquired scoring session', async () => {
    const team=await rosterTeam();const game=(await gameRows())[0];
    await pool.query("UPDATE matches SET status='IN_PROGRESS' WHERE id=$1",[game.id]);
    expect((await request(teams,'PUT',rosterBody(team))).statusCode).toBe(409);
    await pool.query("UPDATE matches SET status='SCHEDULED' WHERE id=$1",[game.id]);
    const token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect((await request(scoringLock,'POST',{matchId:game.id,token,action:'acquire'},{},'umpire')).statusCode).toBe(200);
    expect((await request(teams,'PUT',rosterBody(team))).statusCode).toBe(409);
    expect((await pool.query('SELECT * FROM teams WHERE id=$1',[team.id])).rows[0]).toEqual(team);
    expect((await request(scoringLock,'POST',{matchId:game.id,token,action:'release'},{},'umpire')).statusCode).toBe(200);
    expect((await request(teams,'PUT',rosterBody(team))).statusCode).toBe(200);
  });

  it('preserves completed game records when updating the current team roster', async () => {
    const team=await rosterTeam();
    await pool.query("UPDATE matches SET status='FINAL',is_complete=true,innings=$1",[JSON.stringify([{number:1,home:{playerScores:[{playerId:team.players[0].id,pitches:[{points:4}]}]},away:{playerScores:[]}}])]);
    const before=await gameRows();const body={...rosterBody(team),players:[{...team.players[0],name:'Corrected'},...team.players.slice(1)]};
    expect((await request(teams,'PUT',body)).statusCode).toBe(200);expect(await gameRows()).toEqual(before);
  });

  it('rejects roster mutations from umpires, anonymous callers and archived seasons', async () => {
    const team=await rosterTeam();
    expect((await request(teams,'PUT',rosterBody(team),{},'umpire')).statusCode).toBe(403);
    expect((await request(teams,'PUT',rosterBody(team),{},null)).statusCode).toBe(401);
    expect((await request(teams,'PUT',{...rosterBody(team),season:'2026'})).statusCode).toBe(403);
    await pool.query("UPDATE teams SET season='2026' WHERE id=$1",[team.id]);
    expect((await request(teams,'PUT',rosterBody(team))).statusCode).toBe(403);
  });

  const oldIdentity = async (name = 'Cody', rosterId = 'historic-cody', personId = '10000000-0000-4000-8000-000000000001') => {
    await pool.query("INSERT INTO league_players(id,name,last_name) VALUES($1,$2,'Test')",[personId,name]);
    await pool.query("INSERT INTO player_identity_links(roster_player_id,player_id,resolution) VALUES($1,$2,'existing')",[rosterId,personId]);
    await pool.query("INSERT INTO teams(id,name,league,season,players,subs) VALUES($1,'Previous Team','Past','2026',$2,'[]')",[rosterId+'-team',JSON.stringify([{id:rosterId,name,lastName:'Test'}])]);
    return personId;
  };
  it('requires confirmation before matching a returning player and preserves historic pitches', async () => {
    const team=await rosterTeam(2),personId=await oldIdentity();const before=await gameRows();
    const body={...rosterBody(team),players:[...team.players,{id:'returning-entry',name:'Cody',lastName:''}]};
    expect((await request(teams,'PUT',body)).statusCode).toBe(409);
    expect((await pool.query("SELECT * FROM player_identity_links WHERE roster_player_id='returning-entry'")).rows).toHaveLength(0);
    const result=await request(teams,'PUT',{...body,identityChoices:{'returning-entry':personId}});
    expect(result.statusCode).toBe(200);
    expect(result.body.identityLinks.find((l:any)=>l.rosterPlayerId==='returning-entry').personId).toBe(personId);
    expect((await pool.query('SELECT last_name FROM league_players WHERE id=$1',[personId])).rows[0].last_name).toBe('Test');
    expect(await gameRows()).toEqual(before);
  });
  it('keeps two identical names separate when the admin confirms a different person',async()=>{
    const team=await rosterTeam(2),previous=await oldIdentity();
    const result=await request(teams,'PUT',{...rosterBody(team),players:[...team.players,{id:'different-cody',name:'Cody',lastName:'Test'}],identityChoices:{'different-cody':'new'}});
    expect(result.statusCode).toBe(200);
    expect(result.body.identityLinks.find((l:any)=>l.rosterPlayerId==='different-cody').personId).not.toBe(previous);
  });
  it('rejects forged identity choices and does not partially save names or links',async()=>{
    const team=await rosterTeam(2);await oldIdentity();const before=await gameRows();
    const result=await request(teams,'PUT',{...rosterBody(team),players:[...team.players,{id:'forged',name:'Cody',lastName:'Test'}],identityChoices:{forged:'99999999-9999-4999-8999-999999999999'}});
    expect(result.statusCode).toBe(400);expect(await gameRows()).toEqual(before);
    expect((await pool.query('SELECT * FROM teams WHERE id=$1',[team.id])).rows[0]).toEqual(team);
    expect((await pool.query("SELECT * FROM player_identity_links WHERE roster_player_id='forged'")).rows).toHaveLength(0);
  });
  it('keeps permanent identity when a registered player name changes',async()=>{
    const team=await rosterTeam();await request(teams,'PUT',rosterBody(team));
    const before=(await pool.query('SELECT * FROM player_identity_links ORDER BY roster_player_id')).rows;
    const body={...rosterBody(team),players:[{...team.players[0],name:'Corrected Name'},...team.players.slice(1)]};
    expect((await request(teams,'PUT',body)).statusCode).toBe(200);
    const after=(await pool.query('SELECT * FROM player_identity_links ORDER BY roster_player_id')).rows;
    expect(after).toEqual(before);
  });
  it('rejects two roster entries linked to the same permanent player',async()=>{
    const team=await rosterTeam(2),id=await oldIdentity('Player 1');
    const currentPerson=(await pool.query("SELECT player_id FROM player_identity_links WHERE roster_player_id='roster-player-0'")).rows[0].player_id;
    const body={...rosterBody(team),players:[team.players[0],{...team.players[1],name:'Unrelated'},{id:'same-person-again',name:'Player 1',lastName:'Test'}],identityChoices:{'roster-player-0':id,'same-person-again':id},expectedIdentityLinks:{'roster-player-0':currentPerson}};
    expect((await request(teams,'PUT',body)).statusCode).toBe(400);
  });

  it('offers shortened-name matches without automatically joining identities',async()=>{
    const team=await rosterTeam(2),id=await oldIdentity('Michael');
    const body={...rosterBody(team),players:[...team.players,{id:'mike-entry',name:'Mike',lastName:'Test'}]};
    expect((await request(teams,'PUT',body)).statusCode).toBe(409);
    const result=await request(teams,'PUT',{...body,identityChoices:{'mike-entry':id}});
    expect(result.statusCode).toBe(200);expect(result.body.identityLinks.find((l:any)=>l.rosterPlayerId==='mike-entry').personId).toBe(id);
  });
  it('manually links an already-saved different name and rejects a stale identity edit',async()=>{
    const team=await rosterTeam(),id=await oldIdentity('Michael');
    const initial=await request(teams,'PUT',rosterBody(team));expect(initial.statusCode).toBe(200);
    const original=initial.body.identityLinks.find((l:any)=>l.rosterPlayerId===team.players[0].id).personId;
    const savedTeam=(await pool.query('SELECT * FROM teams WHERE id=$1',[team.id])).rows[0];
    const body={...rosterBody(savedTeam),identityChoices:{[team.players[0].id]:id},expectedIdentityLinks:{[team.players[0].id]:original}};
    const before=await gameRows();const linked=await request(teams,'PUT',body);
    expect(linked.statusCode).toBe(200);expect(linked.body.identityLinks.find((l:any)=>l.rosterPlayerId===team.players[0].id).personId).toBe(id);
    expect(await gameRows()).toEqual(before);
    expect((await request(teams,'PUT',body)).statusCode).toBe(409);
    expect((await pool.query('SELECT player_id FROM player_identity_links WHERE roster_player_id=$1',[team.players[0].id])).rows[0].player_id).toBe(id);
  });

  it('prevents other entry points from borrowing an older roster ID to bypass identity confirmation',async()=>{
    const team=await rosterTeam();await oldIdentity('Michael');
    const borrowed={id:'historic-cody',name:'Michael',lastName:'Test'};
    const create=await request(teams,'POST',{id:'borrowed-team',name:'Borrowed Team',league:'11U',season:'2027',players:[borrowed,{id:'another-new-id',name:'Other'}],subs:[]});
    expect(create.statusCode).toBe(409);
    expect((await pool.query("SELECT * FROM teams WHERE id='borrowed-team'")).rows).toHaveLength(0);
    const update=await request(teams,'PUT',{id:team.id,name:team.name,season:'2027',players:team.players,subs:[...team.subs,borrowed]},{},'umpire');
    expect(update.statusCode).toBe(409);
    expect((await request(teams,'PUT',{id:team.id,name:team.name,season:'2027',players:[team.players[0],team.players[0]],subs:team.subs})).statusCode).toBe(400);
    expect((await pool.query('SELECT * FROM teams WHERE id=$1',[team.id])).rows[0]).toEqual(team);
  });

  const createPayload = (name='Eagles',size=3) => ({action:'create_team_roster',id:randomUUID(),name,league:'11U',season:'2027',
    players:Array.from({length:size},(_,i)=>({id:randomUUID(),name:`Real ${i+1}`,lastName:'Member'})),subs:[] as {id:string;name:string;lastName:string}[]});
  const addLeague = () => request(leagues,'POST',{id:'11U',season:'2027'});
  it.each([2,3])('creates a %s-player team before import and reuses its exact roster and identities',async size=>{
    await addLeague();const body=createPayload('Eagles',size);const created=await request(teams,'POST',body);
    expect(created.statusCode).toBe(201);
    const links=created.body.identityLinks;
    const result=await request(schedule,'POST',{...payload,csvText:file.replace('Eagles',' eAgLeS ')});
    expect(result.statusCode).toBe(200);expect(result.body.createdTeams).toEqual(['Panthers']);
    const saved=(await pool.query('SELECT * FROM matches')).rows[0];
    expect(saved.home_team_id).toBe(body.id);expect(saved.innings[0].home.playerScores.map((p:any)=>p.playerId)).toEqual(body.players.map(p=>p.id));
    expect((await pool.query('SELECT * FROM teams WHERE id=$1',[body.id])).rows[0].players).toEqual(created.body.players);
    expect((await request(teams,'GET',{}, {adminRoster:'1',season:'2027'})).body.identityLinks).toEqual(links);
  });
  it('imports empty rosters and initializes only their unplayed lineups when real rosters are filled',async()=>{
    await importFile();const imported=(await pool.query('SELECT * FROM teams ORDER BY name')).rows;
    expect(imported.every(team=>team.players.length===0)).toBe(true);
    const before=(await pool.query('SELECT * FROM matches')).rows[0];
    for(const [index,team] of imported.entries()){
      const size=index===0?2:3;
      expect((await request(teams,'PUT',{action:'update_roster',id:team.id,season:'2027',expectedRoster:{players:[],subs:[]},players:createPayload('Roster',size).players,subs:[]})).statusCode).toBe(200);
    }
    const game=(await pool.query('SELECT * FROM matches')).rows[0];
    expect(game.id).toBe(before.id);expect(game.status).toBe('SCHEDULED');
    expect(game.innings[0].home.playerScores).toHaveLength(2);expect(game.innings[0].home.playerScores[0].pitches).toHaveLength(15);
    expect(game.innings[0].away.playerScores).toHaveLength(3);expect(game.innings.every((inning:any)=>[...inning.home.playerScores,...inning.away.playerScores].every((p:any)=>p.pitches.every((pitch:any)=>pitch.points===null)))).toBe(true);
  });
  it('creates a team after import, edits an unplayed matchup, and appends future CSV games without changing its roster',async()=>{
    await importFile();const body=createPayload('New Team');expect((await request(teams,'POST',body)).statusCode).toBe(201);
    const original=(await pool.query('SELECT * FROM matches')).rows[0];
    const result=await request(schedule,'PATCH',{action:'update_game',season:'2027',id:original.id,revision:Number(original.revision),date:'2027-11-01',startTime:'6:00 pm',endTime:'7:00 pm',location:'Tunnels 5/6',notes:'New team added',homeTeamId:body.id,awayTeamId:original.away_team_id});
    expect(result.statusCode).toBe(200);
    const edited=(await pool.query('SELECT * FROM matches WHERE id=$1',[original.id])).rows[0];
    expect(edited.home_team_id).toBe(body.id);
    expect(edited.innings[0].home.playerScores.map((p:any)=>p.playerId)).toEqual(body.players.map(p=>p.id));
    const after=(await pool.query('SELECT * FROM matches WHERE id=$1',[original.id])).rows[0];
    const added=await request(schedule,'POST',{...payload,csvText:file.replace('Eagles','New Team').replace('2027-11-01','2027-11-08')});
    expect(added.statusCode).toBe(200);expect(added.body.createdTeams).toEqual([]);
    expect((await pool.query('SELECT * FROM matches WHERE id=$1',[original.id])).rows[0]).toEqual(after);
    expect((await pool.query('SELECT * FROM teams WHERE id=$1',[body.id])).rows[0].players).toEqual(body.players);
  });
  it('rejects a replacement CSV in an occupied slot with guidance to edit, without creating its team or changing games',async()=>{
    await importFile();const before=await gameRows(),beforeCounts=await counts();
    const result=await request(schedule,'POST',{...payload,csvText:file.replace('Eagles','Replacement Team')});
    expect(result.statusCode).toBe(409);expect(result.body.error).toContain('Tunnels 5/6');
    expect(await gameRows()).toEqual(before);expect(await counts()).toEqual(beforeCounts);
  });
  it('retries a lost-response team creation without creating another team or identity',async()=>{
    await addLeague();const body=createPayload();const first=await request(teams,'POST',body);
    const rows=(await pool.query('SELECT * FROM player_identity_links ORDER BY roster_player_id')).rows;
    expect((await request(teams,'POST',body)).statusCode).toBe(201);
    expect((await counts()).teams).toBe(1);expect((await pool.query('SELECT * FROM player_identity_links ORDER BY roster_player_id')).rows).toEqual(rows);
    expect(first.body.id).toBe(body.id);
    expect((await request(teams,'POST',{...body,name:'Changed draft'})).statusCode).toBe(409);
  });
  it('serializes simultaneous duplicate team creation',async()=>{
    await addLeague();const first=createPayload(),second=createPayload();
    const duplicates=await Promise.all([request(teams,'POST',first),request(teams,'POST',second)]);
    expect(duplicates.map(r=>r.statusCode).sort()).toEqual([201,409]);
    expect((await counts()).teams).toBe(1);
    expect((await request(schedule,'POST',payload)).statusCode).toBe(200);
    expect((await counts()).teams).toBe(2);
    const winner=duplicates.find(r=>r.statusCode===201)!;
    expect((await pool.query('SELECT home_team_id FROM matches')).rows[0].home_team_id).toBe(winner.body.id);
  });
  it('blocks malformed, unauthenticated and archived new-team requests without partial identities',async()=>{
    await addLeague();const body=createPayload();
    expect((await request(teams,'POST',body,{},null)).statusCode).toBe(401);
    expect((await request(teams,'POST',body,{},'umpire')).statusCode).toBe(403);
    expect((await request(teams,'POST',{...body,season:'2026'})).statusCode).toBe(403);
    expect((await request(teams,'POST',{...body,players:[body.players[0]]})).statusCode).toBe(400);
    expect((await counts()).teams).toBe(0);expect((await pool.query('SELECT * FROM league_players')).rows).toHaveLength(0);
  });

  it('safely resolves a schedule import racing with team creation',async()=>{
    await addLeague();const body=createPayload();
    const [creation,imported]=await Promise.all([request(teams,'POST',body),request(schedule,'POST',payload)]);
    expect(imported.statusCode).toBe(200);expect([201,409]).toContain(creation.statusCode);
    const home=(await pool.query("SELECT * FROM teams WHERE name='Eagles'")).rows[0];
    if(creation.statusCode===409)expect((await request(teams,'PUT',{action:'update_roster',id:home.id,season:'2027',expectedRoster:{players:[],subs:[]},players:body.players,subs:[]})).statusCode).toBe(200);
    expect((await counts()).teams).toBe(2);
    const game=(await pool.query('SELECT * FROM matches')).rows[0];
    expect(game.home_team_id).toBe(home.id);expect(game.innings[0].home.playerScores.map((p:any)=>p.playerId)).toEqual(body.players.map(p=>p.id));
  });
  it('creates a roster with a confirmed returning player and a substitute atomically',async()=>{
    await addLeague();const older=await oldIdentity('Michael'),body=createPayload('Returning Team',2);
    body.players[0]={...body.players[0],name:'Mike',lastName:'Test'};
    body.subs=[{id:randomUUID(),name:'Bench',lastName:'Member'}];
    expect((await request(teams,'POST',body)).statusCode).toBe(409);
    expect((await counts()).teams).toBe(1); // Only the synthetic previous-season team.
    const result=await request(teams,'POST',{...body,identityChoices:{[body.players[0].id]:older}});
    expect(result.statusCode).toBe(201);expect(result.body.subs).toHaveLength(1);
    expect(result.body.identityLinks.find((link:any)=>link.rosterPlayerId===body.players[0].id).personId).toBe(older);
    expect((await request(teams,'POST',{...body,identityChoices:{[body.players[0].id]:'new'}})).statusCode).toBe(409);
  });
  it('cannot start an imported game whose real rosters have not been supplied',async()=>{
    await importFile();const game=(await pool.query('SELECT * FROM matches')).rows[0];
    const token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect((await request(scoringLock,'POST',{matchId:game.id,token,action:'acquire'},{},'umpire')).statusCode).toBe(200);
    const start=(req:any,res:any)=>matches({...req,headers:{...req.headers,'x-scoring-token':token}},res);
    const result=await request(start,'PUT',{id:game.id,revision:Number(game.revision),status:'IN_PROGRESS'},{},'umpire');
    expect(result.statusCode).toBe(400);expect((await pool.query('SELECT * FROM matches WHERE id=$1',[game.id])).rows[0]).toEqual(game);
  });

  it('requires existing overlaps to be resolved even when saving only notes',async()=>{
    await importFile();const game=(await gameRows())[0];
    await pool.query(`INSERT INTO matches(id,league,season,home_team_id,away_team_id,date,start_time,end_time,location,status,is_complete,innings)
      SELECT $1,league,season,home_team_id,away_team_id,date,start_time,end_time,location,status,is_complete,innings FROM matches WHERE id=$2`,[randomUUID(),game.id]);
    const body={action:'update_game',season:'2027',id:game.id,revision:Number(game.revision),date:'2027-11-01',startTime:'18:00',endTime:'19:00',location:'Tunnels 5/6',notes:'Bring helmets',homeTeamId:game.home_team_id,awayTeamId:game.away_team_id};
    const result=await request(schedule,'PATCH',body);
    expect(result.statusCode).toBe(409);
    const saved=(await pool.query('SELECT * FROM matches WHERE id=$1',[game.id])).rows[0];
    expect(saved).toEqual(game);
    const conflicting=await request(schedule,'PATCH',{...body,revision:Number(saved.revision),startTime:'6:05 pm'});
    expect(conflicting.statusCode).toBe(409);expect((await pool.query('SELECT * FROM matches WHERE id=$1',[game.id])).rows[0]).toEqual(saved);
    const resolved=await request(schedule,'PATCH',{...body,revision:Number(saved.revision),startTime:'7:00 pm',endTime:'8:00 pm'});
    expect(resolved.statusCode).toBe(200);expect(resolved.body.warning).toBeUndefined();
  });
  it('still rejects a team change that overlaps its existing cage',async()=>{
    await importFile();const game=(await gameRows())[0],newTeam=createPayload('Replacement');
    expect((await request(teams,'POST',newTeam)).statusCode).toBe(201);
    await pool.query(`INSERT INTO matches(id,league,season,home_team_id,away_team_id,date,start_time,end_time,location,status,is_complete,innings)
      SELECT $1,league,season,home_team_id,away_team_id,date,start_time,end_time,location,status,is_complete,innings FROM matches WHERE id=$2`,[randomUUID(),game.id]);
    const before=await gameRows();
    const result=await request(schedule,'PATCH',{action:'update_game',season:'2027',id:game.id,revision:Number(game.revision),date:'2027-11-01',startTime:'6:00 pm',endTime:'7:00 pm',location:'Tunnels 5/6',notes:'Changed team',homeTeamId:newTeam.id,awayTeamId:game.away_team_id});
    expect(result.statusCode).toBe(409);expect(await gameRows()).toEqual(before);
  });
  it('does not initialize an empty lineup if the opponent has a recorded zero',async()=>{
    await importFile();const game=(await gameRows())[0];const home=(await pool.query('SELECT * FROM teams WHERE id=$1',[game.home_team_id])).rows[0];
    const innings=game.innings;innings[0].away.playerScores=[{playerId:'opponent',pitches:[{points:0}]}];
    await pool.query('UPDATE matches SET innings=$1 WHERE id=$2',[JSON.stringify(innings),game.id]);const before=await gameRows();
    const result=await request(teams,'PUT',{action:'update_roster',season:'2027',id:home.id,expectedRoster:{players:[],subs:[]},players:createPayload().players,subs:[]});
    expect(result.statusCode).toBe(200);expect(await gameRows()).toEqual(before);
  });

  it('allows booking-only edits and preserves even long legacy notes that the editor no longer exposes',async()=>{
    await importFile();const game=(await gameRows())[0],legacyNotes='Historical detail '.repeat(150);
    await pool.query('UPDATE matches SET notes=$1 WHERE id=$2',[legacyNotes,game.id]);
    const result=await request(schedule,'PATCH',{action:'update_game',season:'2027',id:game.id,revision:Number(game.revision),date:'2027-11-08',startTime:'6:00 pm',endTime:'7:00 pm',location:'Tunnels 7/8',homeTeamId:game.home_team_id,awayTeamId:game.away_team_id});
    expect(result.statusCode).toBe(200);const saved=(await pool.query('SELECT * FROM matches WHERE id=$1',[game.id])).rows[0];
    expect(saved.notes).toBe(legacyNotes);expect(saved.innings).toEqual(game.innings);expect(saved.location).toBe('The Dugout: Tunnels 7/8');
  });

  it('keeps identically named teams separate across leagues and years through import, rename and roster edits',async()=>{
    for(const league of ['9U','11U'])expect((await request(leagues,'POST',{id:league,season:'2027'})).statusCode).toBe(201);
    const first={...createPayload('Eagles',2),league:'9U'},second=createPayload('Eagles',3);
    expect((await request(teams,'POST',first)).statusCode).toBe(201);expect((await request(teams,'POST',second)).statusCode).toBe(201);
    const priorId=randomUUID();await pool.query("INSERT INTO teams(id,name,league,season,players,subs) VALUES($1,'Eagles','9U','2026','[]','[]')",[priorId]);
    const imported=await request(schedule,'POST',{action:'import_schedule',season:'2027',csvText:csv([
      '2027-11-01,6:00 pm,7:00 pm,Tunnels 5/6,Young,Eagles,Panthers,',
      '2027-11-01,6:00 pm,7:00 pm,Tunnels 7/8,Older,Eagles,Panthers,'
    ]),leagueDestinations:{Young:{mode:'existing',name:'9U'},Older:{mode:'existing',name:'11U'}}});
    expect(imported.statusCode).toBe(200);expect(imported.body.createdMatches).toBe(2);
    const games=await gameRows();expect(games.find(g=>g.league==='9U').home_team_id).toBe(first.id);expect(games.find(g=>g.league==='11U').home_team_id).toBe(second.id);
    const prior=(await pool.query('SELECT * FROM teams WHERE id=$1',[priorId])).rows[0],other=(await pool.query('SELECT * FROM teams WHERE id=$1',[second.id])).rows[0];
    const edited=await request(teams,'PUT',{action:'update_roster',season:'2027',id:first.id,expectedRoster:{players:first.players,subs:[]},players:first.players.map((p,i)=>({...p,name:i===0?'Changed':p.name})),subs:[]});
    expect(edited.statusCode).toBe(200);
    expect((await request(schedule,'PATCH',{action:'rename_team',season:'2027',id:first.id,teamName:'Golden Eagles'})).statusCode).toBe(200);
    expect((await pool.query('SELECT * FROM teams WHERE id=$1',[second.id])).rows[0]).toEqual(other);expect((await pool.query('SELECT * FROM teams WHERE id=$1',[priorId])).rows[0]).toEqual(prior);
    expect(await gameRows()).toEqual(games);
  });
  it('prevents a bulk move from creating duplicate names in one league',async()=>{
    for(const league of ['9U','11U','13U'])await request(leagues,'POST',{id:league,season:'2027'});
    const a={...createPayload(),league:'9U'},b=createPayload();
    await request(teams,'POST',a);await request(teams,'POST',b);
    const before=(await pool.query('SELECT * FROM teams ORDER BY id')).rows;
    expect((await request(teams,'PATCH',{action:'move_teams',season:'2027',teamIds:[a.id],targetLeague:'11U'})).statusCode).toBe(409);
    expect((await request(teams,'PATCH',{action:'move_teams',season:'2027',teamIds:[a.id,b.id],targetLeague:'13U'})).statusCode).toBe(409);
    expect((await pool.query('SELECT * FROM teams ORDER BY id')).rows).toEqual(before);
  });
  it('preserves two same-name historical team memberships with their league context',async()=>{
    const person=await oldIdentity('Alex');
    await pool.query("UPDATE teams SET name='Eagles',league='9U' WHERE season='2026'");
    const member=randomUUID();await pool.query("INSERT INTO player_identity_links(roster_player_id,player_id,resolution) VALUES($1,$2,'confirmed')",[member,person]);
    await pool.query("INSERT INTO teams(id,name,league,season,players,subs) VALUES($1,'Eagles','11U','2026',$2,'[]')",[randomUUID(),JSON.stringify([{id:member,name:'Alex',lastName:'Test'}])]);
    const result=await request(teams,'GET',{}, {adminRoster:'1',season:'2027'});
    const candidate=result.body.playerHistory.find((p:any)=>p.personId===person);
    expect(candidate.teams).toHaveLength(2);expect(candidate.teams.map((t:any)=>t.league).sort()).toEqual(['11U','9U']);expect(new Set(candidate.teams.map((t:any)=>t.teamId)).size).toBe(2);
  });

  it('blocks a stale legacy team payload from removing a member whose ID can be referenced by games',async()=>{
    const team=await rosterTeam(),sub={id:randomUUID(),name:'Retained substitute',lastName:'Test'};
    expect((await request(teams,'PUT',{...team,subs:[...team.subs,sub]})).statusCode).toBe(200);
    const before=(await pool.query('SELECT * FROM teams WHERE id=$1',[team.id])).rows[0],games=await gameRows();
    const rejected=await request(teams,'PUT',team);expect(rejected.statusCode).toBe(409);expect(rejected.body.error).toContain('protect their game history');
    expect((await pool.query('SELECT * FROM teams WHERE id=$1',[team.id])).rows[0]).toEqual(before);expect(await gameRows()).toEqual(games);
  });

  const releasePlan = async () => {
    // Reproduce Production's absent identity data, after creating synthetic rosters.
    await pool.query('TRUNCATE player_identity_links, league_players');
    const stored=(await pool.query('SELECT * FROM teams ORDER BY id')).rows.map(mapTeamFromDB);
    return {teams:stored,...planPlayerIdentities(stored,randomUUID)};
  };
  const migrationDdl=readFileSync(new URL('../../migrations/player-identities.sql',import.meta.url),'utf8');
  it('rehearses additive identities twice without changing any roster or saved game',async()=>{
    await rosterTeam();const plan=await releasePlan(),beforeTeams=(await pool.query('SELECT * FROM teams ORDER BY id')).rows,beforeGames=await gameRows();
    const sql=identityReleaseSql(plan,migrationDdl);await pool.query(sql);await pool.query(sql);
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM player_identity_links')).rows[0].count).toBe(plan.links.length);
    expect((await pool.query('SELECT * FROM teams ORDER BY id')).rows).toEqual(beforeTeams);expect(await gameRows()).toEqual(beforeGames);
  });
  it('rolls back an identity release when the reviewed roster snapshot has changed',async()=>{
    await rosterTeam();const plan=await releasePlan();await pool.query("UPDATE teams SET name=name || ' changed'");
    const db=await pool.connect();try {await expect(db.query(identityReleaseSql(plan,migrationDdl))).rejects.toThrow('Roster snapshot changed');await db.query('ROLLBACK');} finally {db.release();}
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM league_players')).rows[0].count).toBe(0);
  });
  it('rolls back a reviewed identity release rather than replacing an existing conflicting identity',async()=>{
    await rosterTeam();const plan=await releasePlan(),different=randomUUID();
    await pool.query("INSERT INTO league_players(id,name,last_name) VALUES($1,'Existing','Person')",[different]);
    await pool.query("INSERT INTO player_identity_links(roster_player_id,player_id,resolution) VALUES($1,$2,'new')",[plan.links[0].rosterPlayerId,different]);
    const db=await pool.connect();try {await expect(db.query(identityReleaseSql(plan,migrationDdl))).rejects.toThrow('Existing identity differs');await db.query('ROLLBACK');} finally {db.release();}
    expect((await pool.query('SELECT id FROM league_players')).rows).toEqual([{id:different}]);
    expect((await pool.query('SELECT player_id FROM player_identity_links')).rows).toEqual([{player_id:different}]);
  });

  const calendarFixture=async()=>{
    await importFile();const a=(await gameRows())[0],b=randomUUID(),c=randomUUID();
    for(const [id,start,end] of [[b,'19:00','20:00'],[c,'20:00','21:00']])await pool.query(`INSERT INTO matches(id,league,season,home_team_id,away_team_id,date,start_time,end_time,location,status,is_complete,innings)
      SELECT $1,league,season,home_team_id,away_team_id,date,$3,$4,location,status,is_complete,innings FROM matches WHERE id=$2`,[id,a.id,start,end]);
    return {a:a.id,b,c};
  };
  const workspace=async()=> (await request(schedule,'POST',{action:'preview_resolution',season:'2027'})).body;
  const resolutionPayload=(changes:any[],extra:any={})=>({action:'resolve_schedule',season:'2027',requestId:randomUUID(),changes,...extra});
  it('reports every cage/team overlap and permits chained three-game resolution in one save',async()=>{
    const ids=await calendarFixture(),w=await workspace(),base=await gameRows();
    const a={...w.games.find((g:any)=>g.id===ids.a),startTime:'19:00',endTime:'20:00'};
    const b={...w.games.find((g:any)=>g.id===ids.b),startTime:'20:00',endTime:'21:00'};
    const c={...w.games.find((g:any)=>g.id===ids.c),startTime:'21:00',endTime:'22:00'};
    const blocked=await request(schedule,'POST',resolutionPayload([a,b]));expect(blocked.statusCode).toBe(409);expect(blocked.body.resolution.games).toHaveLength(3);expect(await gameRows()).toEqual(base);
    const body=resolutionPayload([a,b,c]);expect((await request(schedule,'POST',body)).statusCode).toBe(200);
    const saved=await gameRows();expect(saved.map(g=>g.innings)).toEqual(base.map(g=>g.innings));expect(saved.every(g=>Number(g.revision)===1)).toBe(true);
    expect((await request(schedule,'POST',body)).statusCode).toBe(200);expect(await gameRows()).toEqual(saved);
  });
  it('previews conflicts without saving anything, including a cancelled import with new leagues and teams',async()=>{
    await importFile();const before=await counts(),games=await gameRows();
    const importBody={action:'preview_import',season:'2027',csvText:csv(['2027-11-01,6:00 pm,7:00 pm,Tunnels 5/6,New Group,New Home,New Away,']),leagueDestinations:{'New Group':{mode:'new',name:'Another League'}}};
    const preview=await request(schedule,'POST',importBody);expect(preview.statusCode).toBe(200);expect(preview.body.resolution.rootIds).toHaveLength(1);expect(preview.body.resolution.games).toHaveLength(2);
    expect(await counts()).toEqual(before);expect(await gameRows()).toEqual(games);
    const imported=preview.body.resolution.games.find((g:any)=>g.kind==='import');
    const rejected=await request(schedule,'POST',resolutionPayload([imported],{import:{csvText:importBody.csvText,leagueDestinations:importBody.leagueDestinations}}));
    expect(rejected.statusCode).toBe(409);expect(await counts()).toEqual(before);expect(await gameRows()).toEqual(games);
    const result=await request(schedule,'POST',resolutionPayload([{...imported,startTime:'21:00',endTime:'22:00'}],{import:{csvText:importBody.csvText,leagueDestinations:importBody.leagueDestinations}}));
    expect(result.statusCode).toBe(200);expect(result.body.summary.createdMatches).toBe(1);expect((await counts()).matches).toBe(2);
  });
  it('atomically imports adjusted rows together with changes to an existing game',async()=>{
    await importFile();const w=await workspace(),existing=w.games[0];
    const input={csvText:csv(['2027-11-01,6:00 pm,7:00 pm,Tunnels 5/6,CSV Group,Third,Fourth,']),leagueDestinations:payload.leagueDestinations};
    const preview=await request(schedule,'POST',{action:'preview_import',season:'2027',...input});const imported=preview.body.resolution.games.find((g:any)=>g.kind==='import');
    const result=await request(schedule,'POST',resolutionPayload([{...existing,startTime:'19:00',endTime:'20:00'},imported],{import:input}));
    expect(result.statusCode).toBe(200);expect((await pool.query('SELECT start_time FROM matches WHERE id=$1',[existing.id])).rows[0].start_time).toBe('19:00');
    const again=await request(schedule,'POST',{action:'import_schedule',season:'2027',...input});expect(again.body.alreadyImported).toBe(true);expect((await counts()).matches).toBe(2);
  });
  it('rejects a stale multi-game edit and supplies refreshed games without partial changes',async()=>{
    const ids=await calendarFixture(),w=await workspace(),a=w.games.find((g:any)=>g.id===ids.a),b=w.games.find((g:any)=>g.id===ids.b);
    expect((await request(schedule,'POST',resolutionPayload([{...b,startTime:'22:00',endTime:'23:00'}]))).statusCode).toBe(200);
    const before=await gameRows();const rejected=await request(schedule,'POST',resolutionPayload([{...a,startTime:'19:00',endTime:'20:00'},{...b,startTime:'20:00',endTime:'21:00'}]));
    expect(rejected.statusCode).toBe(409);expect(rejected.body.resolution.games.find((g:any)=>g.id===ids.b).startTime).toBe('22:00');expect(await gameRows()).toEqual(before);
  });
  it.each(['FINAL','IN_PROGRESS','zero','lock','forfeit'])('shows %s games read-only and cannot mutate them through a batch',async protection=>{
    const ids=await calendarFixture();
    if(protection==='zero')await pool.query('UPDATE matches SET innings=$2 WHERE id=$1',[ids.b,JSON.stringify([{number:1,home:{playerScores:[{playerId:'protected',pitches:[{points:0}]}]},away:{playerScores:[]}}])]);
    else if(protection==='forfeit')await pool.query('UPDATE matches SET is_forfeit=TRUE WHERE id=$1',[ids.b]);
    else if(protection==='lock')await pool.query("INSERT INTO scoring_locks(match_id,token_hash) VALUES($1,'owned')",[ids.b]);
    else await pool.query('UPDATE matches SET status=$2 WHERE id=$1',[ids.b,protection]);
    const w=await workspace(),b=w.games.find((g:any)=>g.id===ids.b),before=await gameRows();expect(b.lockedReason).toBeTruthy();
    expect((await request(schedule,'POST',resolutionPayload([{...b,startTime:'22:00',endTime:'23:00',lockedReason:null}]))).statusCode).toBe(409);expect(await gameRows()).toEqual(before);
    expect((await request(schedule,'POST',resolutionPayload([{...w.games.find((g:any)=>g.id===ids.a),startTime:'21:00',endTime:'22:00'}]))).statusCode).toBe(200);
    expect((await pool.query('SELECT * FROM matches WHERE id=$1',[ids.b])).rows[0]).toEqual(before.find(g=>g.id===ids.b));
  });
  it('rolls back earlier game updates and all import provisioning when a later insert fails',async()=>{
    await importFile();const w=await workspace(),existing=w.games[0],before=await gameRows(),beforeCounts=await counts();
    const input={csvText:csv(['2027-11-01,9:00 pm,10:00 pm,Tunnels 5/6,New Group,Third,Fourth,fail-insert']),leagueDestinations:{'New Group':{mode:'new',name:'Rollback League'}}};
    const preview=await request(schedule,'POST',{action:'preview_import',season:'2027',...input});
    // This input has no conflict, so request the editable workspace directly.
    const importW=(await request(schedule,'POST',{action:'preview_resolution',season:'2027',import:input})).body;
    const result=await request(schedule,'POST',resolutionPayload([{...existing,startTime:'19:00',endTime:'20:00'},...importW.games.filter((g:any)=>g.kind==='import')],{import:input}));
    expect(result.statusCode).toBe(500);expect(await counts()).toEqual(beforeCounts);expect(await gameRows()).toEqual(before);
  });
  it('validates new single-game creation and rejects duplicate IDs, wrong leagues and archived edits',async()=>{
    await importFile();const w=await workspace(),base={...w.games[0],id:randomUUID(),kind:'new',revision:0,startTime:'19:00',endTime:'20:00'};
    expect((await request(schedule,'POST',resolutionPayload([{...base,homeTeamId:base.awayTeamId}]))).statusCode).toBe(400);
    expect((await request(schedule,'POST',resolutionPayload([base,base]))).statusCode).toBe(400);
    expect((await request(schedule,'POST',resolutionPayload([{...base,league:'Wrong'}]))).statusCode).toBe(409);
    expect((await request(schedule,'POST',{...resolutionPayload([base]),season:'2025'})).statusCode).toBe(403);
    expect((await request(schedule,'POST',resolutionPayload([base]),{},'umpire')).statusCode).toBe(403);
    expect((await request(schedule,'POST',resolutionPayload([base]))).statusCode).toBe(200);
    const saved=(await pool.query('SELECT * FROM matches WHERE id=$1',[base.id])).rows[0];expect(saved.status).toBe('SCHEDULED');expect(saved.is_complete).toBe(false);
  });

  it('serializes simultaneous edits of one booking so one stale writer is rejected',async()=>{
    await importFile();const w=await workspace(),game=w.games[0];
    const results=await Promise.all([request(schedule,'POST',resolutionPayload([{...game,startTime:'19:00',endTime:'20:00'}])),request(schedule,'POST',resolutionPayload([{...game,startTime:'20:00',endTime:'21:00'}]))]);
    expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
    expect(Number((await gameRows())[0].revision)).toBe(1);
  });
  it('rechecks an umpire lock acquired while the calendar row locks were waiting',async()=>{
    await importFile();const w=await workspace(),game=w.games[0],owner=await pool.connect();
    try{
      await owner.query('BEGIN');await owner.query('SELECT id FROM matches WHERE id=$1 FOR UPDATE',[game.id]);
      const save=request(schedule,'POST',resolutionPayload([{...game,startTime:'19:00',endTime:'20:00'}]));
      let waiting=false;
      for(let i=0;i<50;i++){
        const blocked=(await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE OF m%' AND pid<>pg_backend_pid()" )).rows;
        if(blocked.length){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
      await owner.query("INSERT INTO scoring_locks(match_id,token_hash) VALUES($1,'new-owner')",[game.id]);await owner.query('COMMIT');
      const result=await save;expect(result.statusCode).toBe(409);expect(result.body.resolution.games[0].lockedReason).toContain('umpire');
      expect((await gameRows())[0].start_time).toBe('6:00 pm');
    }finally{await owner.query('ROLLBACK');owner.release();}
  });

  it('updates an unplayed matchup template from the selected rosters and preserves metadata',async()=>{
    await importFile();const replacement=createPayload('Replacement');expect((await request(teams,'POST',replacement)).statusCode).toBe(201);
    const w=await workspace(),game=w.games[0];
    expect((await request(schedule,'POST',resolutionPayload([{...game,homeTeamId:replacement.id}]))).statusCode).toBe(200);
    const saved=(await gameRows())[0];expect(saved.home_team_id).toBe(replacement.id);expect(saved.notes).toBe('Bring balls');
    expect(saved.innings[0].home.playerScores.map((p:any)=>p.playerId)).toEqual(replacement.players.map(p=>p.id));expect(saved.status).toBe('SCHEDULED');
  });
  it('rejects scoring fields in a schedule-only payload without changing saved history',async()=>{
    await importFile();const w=await workspace(),before=await gameRows();
    expect((await request(schedule,'POST',resolutionPayload([{...w.games[0],innings:[],status:'FINAL',startTime:'19:00',endTime:'20:00'}]))).statusCode).toBe(400);expect(await gameRows()).toEqual(before);
  });
  it('does not create unused CSV teams when imported matchups are edited to existing teams',async()=>{
    await importFile();const w=await workspace(),existing=w.games[0],input={csvText:csv(['2027-11-02,6:00 pm,7:00 pm,Tunnels 5/6,CSV Group,Unused Home,Unused Away,']),leagueDestinations:payload.leagueDestinations};
    const importW=(await request(schedule,'POST',{action:'preview_resolution',season:'2027',import:input})).body,imported=importW.games.find((g:any)=>g.kind==='import');
    const result=await request(schedule,'POST',resolutionPayload([{...imported,homeTeamId:existing.homeTeamId,awayTeamId:existing.awayTeamId}],{import:input}));
    expect(result.statusCode).toBe(200);expect(result.body.summary.createdTeams).toEqual([]);expect((await counts()).teams).toBe(2);
    const retry=await request(schedule,'POST',{action:'preview_import',season:'2027',...input});expect(retry.body.games[0].homeTeamName).toBe('Eagles');expect(retry.body.summary.alreadyImported).toBe(true);
  });

  it('does not silently discard an admin edit when another admin imported the same CSV first',async()=>{
    await importFile();const w=await workspace(),existing=w.games[0],input={csvText:csv(['2027-11-02,6:00 pm,7:00 pm,Tunnels 5/6,CSV Group,Third,Fourth,']),leagueDestinations:payload.leagueDestinations};
    const planned=(await request(schedule,'POST',{action:'preview_resolution',season:'2027',import:input})).body;
    const imported=planned.games.find((g:any)=>g.kind==='import');
    expect((await request(schedule,'POST',{action:'import_schedule',season:'2027',...input})).statusCode).toBe(200);
    const before=await gameRows();
    const rejected=await request(schedule,'POST',resolutionPayload([{...existing,startTime:'19:00',endTime:'20:00'},imported],{import:input}));
    expect(rejected.statusCode).toBe(409);expect(rejected.body.resolution.importAlreadySaved).toBe(true);expect(await gameRows()).toEqual(before);
    const retry=await request(schedule,'POST',resolutionPayload([{...existing,startTime:'19:00',endTime:'20:00'}]));expect(retry.statusCode).toBe(200);expect((await counts()).matches).toBe(2);
  });

  it('reconciles a partially imported CSV to real game IDs and preserves the remaining edits',async()=>{
    await importFile();
    const rows=['2027-11-02,6:00 pm,7:00 pm,Tunnels 5/6,CSV Group,Third,Fourth,','2027-11-03,6:00 pm,7:00 pm,Tunnels 5/6,CSV Group,Fifth,Sixth,'];
    const input={csvText:csv(rows),leagueDestinations:payload.leagueDestinations};
    const old=(await request(schedule,'POST',{action:'preview_resolution',season:'2027',import:input})).body.games.filter((g:any)=>g.kind==='import');
    expect((await request(schedule,'POST',{action:'import_schedule',season:'2027',csvText:csv([rows[0]]),leagueDestinations:input.leagueDestinations})).statusCode).toBe(200);
    const rejected=await request(schedule,'POST',resolutionPayload([{...old[0],startTime:'19:00',endTime:'20:00'},old[1]],{import:input}));
    expect(rejected.statusCode).toBe(409);const fresh=rejected.body.resolution;
    const actualId=fresh.replacements[old[0].id];expect(actualId).toBeTruthy();expect(actualId).not.toBe(old[0].id);
    const saved=await request(schedule,'POST',resolutionPayload([{...fresh.games.find((g:any)=>g.id===actualId),startTime:'19:00',endTime:'20:00'},...fresh.games.filter((g:any)=>g.kind==='import')],{import:input}));
    expect(saved.statusCode).toBe(200);expect(saved.body.summary.createdMatches).toBe(1);expect(saved.body.summary.skippedDuplicates).toBe(1);
    expect((await counts()).matches).toBe(3);expect((await pool.query('SELECT start_time FROM matches WHERE id=$1',[actualId])).rows[0].start_time).toBe('19:00');
  });

});
