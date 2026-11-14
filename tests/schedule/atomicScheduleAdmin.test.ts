import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signSessionToken } from '../../api/auth';

const connect = vi.fn();
const queryPool = vi.fn();
vi.mock('../../api/db.js', () => ({
  default: { connect: (...args: unknown[]) => connect(...args), query: (...args: unknown[]) => queryPool(...args) },
}));
import scheduleHandler from '../../api/schedule-admin';
import teamsHandler from '../../api/teams';

const blankInnings = [{
  number: 1,
  home: { teamId: 'home', playerScores: [{ playerId: 'a', pitches: [{ points: null }] }] },
  away: { teamId: 'away', playerScores: [{ playerId: 'b', pitches: [{ points: null }] }] },
}];

const game = {
  date: '2026-11-16', season: '2026', group: '9U - Mondays',
  scheduledIsoDate: '2026-11-16T18:00:00.000Z',
  startTime: '6:00 pm', endTime: '7:00 pm', location: 'The Dugout',
  homeTeamName: 'Tigers', awayTeamName: 'Bears'
};

const makeRequest = (method: string, body: object = {}, query: object = {}, role: 'admin' | 'umpire' | null = 'admin') => ({
  method, body, query, headers: role ? { authorization: 'Bearer ' + signSessionToken(role) } : {},
});

const makeResponse = () => {
  const r: any = { statusCode: 200, body: undefined };
  r.status = vi.fn((code: number) => { r.statusCode = code; return r; });
  r.json = vi.fn((obj: any) => { r.body = obj; return r; });
  r.setHeader = vi.fn();
  return r;
};

describe('Atomic schedule administration', () => {
  let query: any;
  let release: ReturnType<typeof vi.fn>;
  let rows: { leagues: any[], teams: any[], matches: any[] };

  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', 'schedule-QC-admin-session-secret-not-for-production-2026');
    rows = {
      leagues: [{ id: '9U - Mondays', season: '2026' }],
      teams: [
        { id: 'home', name: 'Tigers', league: '9U - Mondays', season: '2026', players: [{ id: 'p1', name: 'Jim' }] },
        { id: 'away', name: 'Bears', league: '9U - Mondays', season: '2026', players: [{ id: 'p2', name: 'Sam' }] }
      ],
      matches: [],
    };
    query = vi.fn(async (statement: string, parameters?: any[]) => {
      if (['BEGIN','COMMIT','ROLLBACK'].includes(statement) || statement.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (statement.includes("FROM app_settings WHERE key='current_season'")) return { rows: [{ value: '2026' }] };
      if (statement.includes('FROM leagues')) return { rows: rows.leagues };
      if (statement.includes('FROM teams')) return { rows: rows.teams };
      if (statement.includes('FROM matches') && statement.includes('is_practice IS FALSE')) return { rows: rows.matches };
      if (statement.startsWith('INSERT INTO matches')) {
        rows.matches.push({ id: parameters?.[0], league: parameters?.[1], season: parameters?.[2],
          home_team_id: parameters?.[3], away_team_id: parameters?.[4], date: parameters?.[5] });
        return { rows: [] };
      }
      if (statement.startsWith('INSERT INTO teams')) return { rows: [] };
      if (statement.startsWith('INSERT INTO leagues')) return { rows: [] };
      if (statement.includes('SELECT * FROM matches') && statement.includes('FOR UPDATE')) return { rows: [] };
      if (statement.startsWith('SELECT 1 FROM scoring_locks')) return { rows: [] };
      if (statement.startsWith('DELETE FROM matches')) return { rows: [] };
      throw new Error('Unexpected mock SQL: ' + statement);
    });
    release = vi.fn();
    connect.mockResolvedValue({ query, release });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it('rejects anonymous users and umpires before touching any database table', async () => {
    const anonymous = makeResponse();
    await scheduleHandler(makeRequest('POST', { action: 'import', games: [game] }, {}, null) as any, anonymous);
    expect(anonymous.statusCode).toBe(401);
    const umpire = makeResponse();
    await scheduleHandler(makeRequest('DELETE', {}, { id: 'game-1' }, 'umpire') as any, umpire);
    expect(umpire.statusCode).toBe(403);
    expect(connect).not.toHaveBeenCalled();
  });

  it('rejects importing games into an archived season before any inserts', async () => {
    const response = makeResponse();
    await scheduleHandler(makeRequest('POST', {
      action: 'import', games: [{ ...game, season: '2025' }]
    }) as any, response);
    expect(response.statusCode).toBe(409);
    expect(response.body.error).toMatch(/active 2026 season/);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query.mock.calls.some((call: any[]) => String(call[0]).startsWith('INSERT INTO'))).toBe(false);
  });

  it('rejects a mixed-season CSV batch atomically', async () => {
    const response = makeResponse();
    await scheduleHandler(makeRequest('POST', {
      action: 'import', games: [game, { ...game, season: '2027', date: '2027-11-01',
        scheduledIsoDate: '2027-11-01T18:00:00.000Z' }]
    }) as any, response);
    expect(response.statusCode).toBe(409);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query.mock.calls.some((call: any[]) => String(call[0]).startsWith('INSERT INTO'))).toBe(false);
  });

  it('blocks imports if the active season cannot be verified', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (...args: any[]) =>
      String(args[0]).includes("FROM app_settings WHERE key='current_season'")
        ? { rows: [] } : original(...args));
    const response = makeResponse();
    await scheduleHandler(makeRequest('POST', { action: 'import', games: [game] }) as any, response);
    expect(response.statusCode).toBe(503);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query.mock.calls.some((call: any[]) => String(call[0]).startsWith('INSERT INTO'))).toBe(false);
  });

  it('creates a valid schedule in a single transaction', async () => {
    const res = makeResponse();
    await scheduleHandler(makeRequest('POST', { action: 'import', games: [game] }) as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.createdMatches).toBe(1);
    expect(query).toHaveBeenCalledWith('BEGIN');
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('adds one replacement game using explicit existing-team IDs', async () => {
    const res = makeResponse();
    await scheduleHandler(makeRequest('POST', {
      action: 'create', games: [{ ...game, homeTeamId: 'home', awayTeamId: 'away' }]
    }) as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.createdMatches).toBe(1);
    expect(res.body.createdTeams).toEqual([]);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });

  it('rejects an individual game without team IDs before writing', async () => {
    const res = makeResponse();
    await scheduleHandler(makeRequest('POST', { action: 'create', games: [game] }) as any, res);
    expect(res.statusCode).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses a stale team ID even if the team name looks valid', async () => {
    const res = makeResponse();
    await scheduleHandler(makeRequest('POST', {
      action: 'create', games: [{ ...game, homeTeamId: 'wrong-team', awayTeamId: 'away' }]
    }) as any, res);
    expect(res.statusCode).toBe(409);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
  });

  it('skips a repeated matchup without creating a duplicate', async () => {
    rows.matches = [{ id: 'existing', league: game.group, season: game.season,
      home_team_id: 'away', away_team_id: 'home', date: new Date(game.scheduledIsoDate) }];
    const res = makeResponse();
    await scheduleHandler(makeRequest('POST', { action: 'import', games: [game] }) as any, res);
    expect(res.body.createdMatches).toBe(0);
    expect(res.body.skippedDuplicates).toBe(1);
    expect(query.mock.calls.some((c: any[]) => c[0].startsWith('INSERT INTO matches'))).toBe(false);
  });

  it('uses the same calendar day for MM/DD/YYYY rows', async () => {
    rows.matches = [{ id: 'existing', league: game.group, season: game.season,
      home_team_id: 'home', away_team_id: 'away', date: new Date(game.scheduledIsoDate) }];
    const res = makeResponse();
    await scheduleHandler(makeRequest('POST', { action: 'import', games: [{ ...game, date: '11/16/2026' }] }) as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.skippedDuplicates).toBe(1);
  });

  it('rejects malformed games without beginning a transaction', async () => {
    const res = makeResponse();
    await scheduleHandler(makeRequest('POST', { action: 'import', games: [game, { ...game, date: '2026-02-30' }] }) as any, res);
    expect(res.statusCode).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it('rolls back the entire multi-game import when the second write fails', async () => {
    let creates = 0;
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (...args: any[]) => {
      if (String(args[0]).startsWith('INSERT INTO matches') && ++creates === 2)
        throw new Error('Test-only mid-import connection failure');
      return original(...args);
    });
    const res = makeResponse();
    const another = { ...game, scheduledIsoDate: '2026-11-23T18:00:00.000Z', date: '2026-11-23' };
    await scheduleHandler(makeRequest('POST', { action: 'import', games: [game, another] }) as any, res);
    expect(res.statusCode).toBe(409);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('renames a team without changing any games, rosters or scores', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (...args: any[]) => {
      const sql = String(args[0]);
      if (sql.includes("FROM app_settings WHERE key='current_season'")) return { rows: [{ value: '2026' }] };
      if (sql.includes('FROM teams WHERE id=$1 FOR UPDATE')) return {
        rows: [{ id: 'home', name: 'Tigers', league: '9U - Mondays', season: '2026' }]
      };
      if (sql.includes('SELECT 1 FROM teams WHERE id<>$1')) return { rows: [] };
      if (sql.startsWith('UPDATE teams SET name=')) return {
        rows: [{ id:'home',name:'Blue Tigers',league:'9U - Mondays',season:'2026' }]
      };
      return original(...args);
    });
    const response=makeResponse();
    await teamsHandler(makeRequest('PATCH',{
      action:'rename_team',teamId:'home',name:'Blue Tigers',season:'2026'
    }) as any,response);
    expect(response.statusCode).toBe(200);
    expect(response.body.name).toBe('Blue Tigers');
    expect(query.mock.calls.filter((c:any[]) => String(c[0]).startsWith('UPDATE'))).toHaveLength(1);
    expect(query.mock.calls.some((c:any[]) => String(c[0]).startsWith('UPDATE matches'))).toBe(false);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });

  it('rejects duplicate team names in the same division', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (...args:any[]) => {
      const sql=String(args[0]);
      if(sql.includes("FROM app_settings WHERE key='current_season'"))return {rows:[{value:'2026'}]};
      if(sql.includes('FROM teams WHERE id=$1 FOR UPDATE'))return {rows:[{id:'home',name:'Tigers',season:'2026',league:'9U - Mondays'}]};
      if(sql.includes('SELECT 1 FROM teams WHERE id<>$1'))return {rows:[{ '?column?':1 }]};
      return original(...args);
    });
    const response=makeResponse();
    await teamsHandler(makeRequest('PATCH',{
      action:'rename_team',teamId:'home',name:'Bears',season:'2026'
    }) as any,response);
    expect(response.statusCode).toBe(409);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query.mock.calls.some((c:any[]) => String(c[0]).startsWith('UPDATE teams'))).toBe(false);
  });

  it('edits one unstarted game date, opponents, time and cage without touching others', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (...args: any[]) => {
      const sql = String(args[0]);
      if (sql.includes("FROM app_settings WHERE key='current_season'")) return { rows: [{ value: '2026' }] };
      if (sql.includes('SELECT * FROM matches') && sql.includes('FOR UPDATE')) return {
        rows: [{ id: 'game-1', league: game.group, season: game.season, status: 'SCHEDULED',
          revision: '0', home_team_id: 'home', away_team_id: 'away',
          is_practice: false, is_complete: false, is_forfeit: false, innings: blankInnings, tie_breaker: null }]
      };
      if (sql.includes('FROM scoring_locks')) return { rows: [] };
      if (sql.includes('FROM teams WHERE id=ANY')) return { rows: rows.teams };
      if (sql.includes('FROM leagues WHERE LOWER')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('FROM matches WHERE id<>')) return { rows: [] };
      if (sql.startsWith('UPDATE matches SET league=')) return { rows: [{ revision: '1' }] };
      return original(...args);
    });
    const result = makeResponse();
    await scheduleHandler(makeRequest('PATCH', {
      season:'2026',group:game.group,homeTeamId:'home',awayTeamId:'away',
      date:'2026-11-23',scheduledIsoDate:'2026-11-23T19:00:00.000Z',
      startTime:'7:00 pm',endTime:'8:00 pm',location:'Tunnels 7/8',
      notes:'Moved by admin',expectedRevision:0
    }, {id:'game-1'}) as any, result);
    expect(result.statusCode).toBe(200);
    expect(result.body.revision).toBe(1);
    expect(query.mock.calls.filter((call:any[]) => String(call[0]).startsWith('UPDATE matches SET'))).toHaveLength(1);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });

  it('rejects edits when a game has recorded scores including zero', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (...args: any[]) => {
      const sql=String(args[0]);
      if (sql.includes("FROM app_settings WHERE key='current_season'")) return {rows:[{value:'2026'}]};
      if (sql.includes('SELECT * FROM matches') && sql.includes('FOR UPDATE')) return {
        rows:[{id:'game-1',season:'2026',status:'SCHEDULED',revision:0,is_practice:false,
          is_complete:false,is_forfeit:false,innings:[{...blankInnings[0],home:{
            ...blankInnings[0].home,playerScores:[{playerId:'a',pitches:[{points:0}]}]}}],tie_breaker:null}]
      };
      return original(...args);
    });
    const result=makeResponse();
    await scheduleHandler(makeRequest('PATCH',{
      season:'2026',group:game.group,homeTeamId:'home',awayTeamId:'away',
      date:game.date,scheduledIsoDate:game.scheduledIsoDate,
      startTime:'6:00 pm',endTime:'7:00 pm',location:'Tunnels 5/6',
      notes:'',expectedRevision:0
    },{id:'game-1'}) as any,result);
    expect(result.statusCode).toBe(403);
    expect(query.mock.calls.some((call:any[]) => String(call[0]).startsWith('UPDATE matches SET'))).toBe(false);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('rejects schedule edits with a stale match revision', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (...args:any[]) => {
      const sql=String(args[0]);
      if (sql.includes("FROM app_settings WHERE key='current_season'")) return {rows:[{value:'2026'}]};
      if (sql.includes('SELECT * FROM matches') && sql.includes('FOR UPDATE')) return {
        rows:[{id:'game-1',season:'2026',status:'SCHEDULED',revision:'8',is_practice:false,
          is_complete:false,is_forfeit:false,innings:blankInnings,tie_breaker:null}]
      };
      if(sql.includes('FROM scoring_locks'))return {rows:[]};
      return original(...args);
    });
    const result=makeResponse();
    await scheduleHandler(makeRequest('PATCH',{
      season:'2026',group:game.group,homeTeamId:'home',awayTeamId:'away',
      date:game.date,scheduledIsoDate:game.scheduledIsoDate,
      startTime:'6:00 pm',endTime:'7:00 pm',location:'Tunnels 5/6',
      notes:'',expectedRevision:0
    },{id:'game-1'}) as any,result);
    expect(result.statusCode).toBe(409);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('deletes exactly one unstarted official game, not the whole schedule', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (...args: any[]) => {
      if (String(args[0]).includes('SELECT * FROM matches') && String(args[0]).includes('FOR UPDATE')) return {
        rows: [{ id: 'game-1', status: 'SCHEDULED', is_practice: false,
          is_complete: false, is_forfeit: false, innings: blankInnings, tie_breaker: null }]
      };
      return original(...args);
    });
    const res = makeResponse();
    await scheduleHandler(makeRequest('DELETE', {}, { id: 'game-1' }) as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.deletedId).toBe('game-1');
    expect(query.mock.calls.filter((c: any[]) => String(c[0]).startsWith('DELETE FROM matches'))).toHaveLength(1);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });

  it('prevents deleting any game containing recorded pitches', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (...args: any[]) => {
      if (String(args[0]).includes('SELECT * FROM matches') && String(args[0]).includes('FOR UPDATE')) return {
        rows: [{ id: 'game-1', status: 'SCHEDULED', is_practice: false, is_complete: false,
          is_forfeit: false,
          innings: [{ ...blankInnings[0], home: { ...blankInnings[0].home,
            playerScores: [{ playerId: 'a', pitches: [{ points: 0 }] }] } }],
          tie_breaker: null }]
      };
      return original(...args);
    });
    const res = makeResponse();
    await scheduleHandler(makeRequest('DELETE', {}, { id: 'game-1' }) as any, res);
    expect(res.statusCode).toBe(403);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query.mock.calls.some((c: any[]) => String(c[0]).startsWith('DELETE FROM matches'))).toBe(false);
  });
});
