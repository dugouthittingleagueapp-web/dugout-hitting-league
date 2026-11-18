import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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
const importFile = () => request(schedule, 'POST', payload);

describe.skipIf(!process.env.DUGOUT_TEST_DATABASE_URL)('Schedule workflows on disposable local PostgreSQL', () => {
  beforeAll(async () => {
    vi.stubEnv('SESSION_SECRET', 'disposable-local-integration-test-session-secret');
    await pool.query(`CREATE SCHEMA ${(pool as any).testSchema}`);
    await pool.query(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
    await pool.query(`ALTER TABLE matches ADD COLUMN revision BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN is_forfeit BOOLEAN DEFAULT FALSE, ADD COLUMN forfeiting_team_id TEXT,
      ADD COLUMN forfeit_reason TEXT, ADD COLUMN winning_team_id TEXT,
      ADD CONSTRAINT synthetic_failure CHECK (notes IS DISTINCT FROM 'fail-insert');
      CREATE TABLE scoring_locks (match_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());`);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE leagues, teams, matches, app_settings, scoring_locks');
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
    await importFile();
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
    await importFile();
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
    await importFile();
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
    await pool.query('UPDATE teams SET players=$2, subs=$3 WHERE id=$1', [team.id, JSON.stringify(players), JSON.stringify([{id:'roster-sub',name:'Sub',lastName:'Test'}])]);
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

});
