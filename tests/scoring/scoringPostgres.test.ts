import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { signSessionToken } from '../../api/auth';

vi.mock('../../api/db.js', async () => {
  const { Pool } = await import('pg');
  const connectionString = process.env.DUGOUT_TEST_DATABASE_URL || 'postgres://unused@127.0.0.1:65432/dugout_test_unused';
  const url = new URL(connectionString);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/dugout_test_'))
    throw new Error('Scoring regressions require a disposable localhost dugout_test_* database.');
  const schema = `dugout_scoring_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString, max: 10, options: `-c search_path=${schema}` });
  return { default: Object.assign(pool, { testSchema: schema }) };
});
import pool from '../../api/db';
import matches from '../../api/matches';
import scoringLock from '../../api/scoring-lock';
import { mapMatchFromDB } from '../../utils/dbMappers';
import { scoringFixture } from './scoringFixtures';
import { createEmptyInning } from '../../utils/inningTemplate';

const owner = '11111111-1111-4111-8111-111111111111';
const request = async (handler: any, body: any, role: 'admin' | 'umpire' = 'umpire', method = 'PUT', token = owner) => {
  const response: any = { statusCode: 200 };
  response.status = (status: number) => { response.statusCode = status; return response; };
  response.json = (data: unknown) => { response.body = JSON.parse(JSON.stringify(data)); return response; };
  await handler({ method, body, query: {}, headers: { authorization: `Bearer ${signSessionToken(role)}`, 'x-scoring-token': token } }, response);
  return response;
};
const stored = async () => (await pool.query("SELECT * FROM matches WHERE id='journal-test'")).rows[0];
const snapshot = async () => JSON.stringify(await stored());
const command = (points: number | null = 4, expected: number | null = null, pitchIndex = 0) => ({
  id: 'journal-test', revision: 0, writeId: randomUUID(),
  command: { kind: 'pitch', inning: 1, side: 'home', playerId: 'h1', pitchIndex, expected, points },
});

describe.skipIf(!process.env.DUGOUT_TEST_DATABASE_URL)('Scoring safety on isolated real PostgreSQL', () => {
  beforeAll(async () => {
    vi.stubEnv('SESSION_SECRET', 'local-scoring-regression-session-key-not-deployed');
    await pool.query(`CREATE SCHEMA ${(pool as any).testSchema}`);
    await pool.query(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
    await pool.query(`ALTER TABLE matches ADD COLUMN revision BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN is_forfeit BOOLEAN DEFAULT FALSE, ADD COLUMN forfeiting_team_id TEXT,
      ADD COLUMN forfeit_reason TEXT, ADD COLUMN winning_team_id TEXT;
      CREATE TABLE scoring_locks (match_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());`);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE matches, teams, leagues, app_settings, scoring_locks');
    const { game, home, away } = scoringFixture();
    await pool.query("INSERT INTO app_settings VALUES ('current_season','2026'); INSERT INTO leagues(id,season) VALUES ('QC','2026')");
    for (const team of [home, away]) await pool.query('INSERT INTO teams(id,name,league,season,players,subs) VALUES($1,$2,$3,$4,$5,$6)',
      [team.id, team.name, team.league, team.season, JSON.stringify(team.players), JSON.stringify(team.subs)]);
    await pool.query('INSERT INTO matches(id,league,season,home_team_id,away_team_id,date,status,innings) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [game.id, game.league, game.season, game.homeTeamId, game.awayTeamId, game.date, game.status, JSON.stringify(game.innings)]);
    expect((await request(scoringLock, { matchId: game.id, token: owner, action: 'acquire' }, 'umpire', 'POST')).statusCode).toBe(200);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await pool.end(); vi.unstubAllEnvs(); });

  it('applies a pitch and its durable retry receipt in one transaction', async () => {
    const body = command(0);
    const first = await request(matches, body);
    expect(first.statusCode).toBe(200);
    expect(first.body.revision).toBe('1');
    const duplicate = await request(matches, body);
    expect(duplicate.statusCode).toBe(200);
    expect((await stored()).revision).toBe('1');
    expect((await pool.query("SELECT key FROM app_settings WHERE key LIKE 'scoring_ack:%'")).rows).toHaveLength(1);
    expect((await stored()).innings[0].home.playerScores[0].pitches[0].points).toBe(0);
  });
  it('rejects reuse of a receipt ID with different data without another write', async () => {
    const body = command(); expect((await request(matches, body)).statusCode).toBe(200);
    const before = await snapshot();
    const reused = await request(matches, { ...body, command: { ...body.command, points: 3 } });
    expect(reused.statusCode).toBe(409); expect(await snapshot()).toBe(before);
  });
  it('allows exactly one concurrent command for the same source revision', async () => {
    const result = await Promise.all([request(matches, command(4)), request(matches, command(3))]);
    expect(result.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect((await stored()).revision).toBe('1');
  });
  it('rejects another scorer even if they know the current revision', async () => {
    const before = await snapshot();
    expect((await request(matches, command(), 'umpire', 'PUT', '22222222-2222-4222-8222-222222222222')).statusCode).toBe(423);
    expect(await snapshot()).toBe(before);
  });
  it.each([99, -1, 0.5, '4', false, {}, []])('rejects malformed command points %j without changing anything', async value => {
    const before = await snapshot(); const body = command(); (body.command.points as any) = value;
    expect((await request(matches, body)).statusCode).toBe(400);
    expect(await snapshot()).toBe(before);
    expect((await pool.query("SELECT key FROM app_settings WHERE key LIKE 'scoring_ack:%'")).rows).toHaveLength(0);
  });
  it('rejects hidden snapshot fields inside a pitch command', async () => {
    const before = await snapshot();
    expect((await request(matches, { ...command(), innings: [] })).statusCode).toBe(400);
    expect(await snapshot()).toBe(before);
  });
  it('requires the expected prior point even with a current revision', async () => {
    expect((await request(matches, command())).statusCode).toBe(200);
    const before = await snapshot();
    expect((await request(matches, { ...command(3), revision: 1 })).statusCode).toBe(409);
    expect(await snapshot()).toBe(before);
    expect((await request(matches, { ...command(null, 4), revision: 1 })).statusCode).toBe(200);
    expect((await stored()).innings[0].home.playerScores[0].pitches[0].points).toBeNull();
  });
  it('rejects an old full snapshot even if its revision was incorrectly refreshed', async () => {
    const old = mapMatchFromDB(await stored());
    expect((await request(matches, command())).statusCode).toBe(200);
    const before = await snapshot();
    expect((await request(matches, { ...old, revision: 1 })).statusCode).toBe(409);
    expect(await snapshot()).toBe(before);
  });
  it('rejects empty or malformed snapshots rather than erasing history', async () => {
    expect((await request(matches, command())).statusCode).toBe(200);
    const current = mapMatchFromDB(await stored()), before = await snapshot();
    for (const innings of [[], {}, null]) {
      expect((await request(matches, { ...current, innings })).statusCode).toBe(400);
      expect(await snapshot()).toBe(before);
    }
  });
  it('preserves extras when a partial update omits them and rejects explicit clearing', async () => {
    const extras = [{ roundNumber: 1, pitchLimit: 5, homePlayerId: 'h1', awayPlayerId: 'a1', homeScores: [4, null, null, null, null], awayScores: [0, null, null, null, null] }];
    await pool.query('UPDATE matches SET tie_breaker=$1 WHERE id=$2', [JSON.stringify(extras), 'journal-test']);
    expect((await request(matches, { id: 'journal-test', revision: 0, notes: 'Safe note' })).statusCode).toBe(200);
    expect((await stored()).tie_breaker).toEqual(extras);
    const current = mapMatchFromDB(await stored()), before = await snapshot();
    expect((await request(matches, { ...current, tieBreaker: [] })).statusCode).toBe(409);
    expect(await snapshot()).toBe(before);
  });
  it.each([5, 3, 1])('applies, retries and undoes a %i-pitch extra-round result', async limit => {
    const extras = [5, 3, 1].slice(0, limit === 5 ? 1 : limit === 3 ? 2 : 3).map((n, i) => ({ roundNumber: i + 1, pitchLimit: n,
      homePlayerId: 'h1', awayPlayerId: 'a1', homeScores: Array(n).fill(null), awayScores: Array(n).fill(null) }));
    await pool.query('UPDATE matches SET tie_breaker=$1 WHERE id=$2', [JSON.stringify(extras), 'journal-test']);
    const body = { id: 'journal-test', revision: 0, writeId: randomUUID(), command: { kind: 'extraPitch', round: extras.length, side: 'away', playerId: 'a1', pitchIndex: limit - 1, expected: null, points: 4 } };
    expect((await request(matches, body)).statusCode).toBe(200);
    expect((await request(matches, body)).statusCode).toBe(200);
    expect((await stored()).revision).toBe('1');
    expect((await request(matches, { ...body, revision: 1, writeId: randomUUID(), command: { ...body.command, expected: 4, points: null } })).statusCode).toBe(200);
    expect((await stored()).tie_breaker[extras.length - 1].awayScores[limit - 1]).toBeNull();
  });
  it('preserves the fifteenth pitch of a two-player lineup', async () => {
    const innings = Array.from({ length: 6 }, (_, i) => createEmptyInning(i + 1, ['h1', 'h2'], ['a1', 'a2', 'a3']));
    await pool.query('UPDATE matches SET innings=$1 WHERE id=$2', [JSON.stringify(innings), 'journal-test']);
    expect((await request(matches, command(4, null, 14))).statusCode).toBe(200);
    expect((await stored()).innings[0].home.playerScores[0].pitches[14].points).toBe(4);
  });
  it('permits a registered substitute but rejects a player from the other team', async () => {
    const game = mapMatchFromDB(await stored()); for (const i of game.innings) i.home.playerScores[0].playerId = 'hsub';
    expect((await request(matches, game)).statusCode).toBe(200);
    const body = { ...command(), revision: 1, command: { ...command().command, playerId: 'hsub' } };
    expect((await request(matches, body)).statusCode).toBe(200);
    const before = await snapshot();
    expect((await request(matches, { ...command(), revision: 2, command: { ...command().command, playerId: 'a1' } })).statusCode).toBe(409);
    expect(await snapshot()).toBe(before);
  });
  it('finalizes once after a lost response and keeps umpire edits locked out', async () => {
    expect((await request(matches, command())).statusCode).toBe(200);
    const current = mapMatchFromDB(await stored());
    const final = { ...current, writeId: randomUUID(), isComplete: true, status: 'FINAL' };
    expect((await request(matches, final)).statusCode).toBe(200);
    expect((await request(matches, final)).statusCode).toBe(200);
    const before = await snapshot();
    expect((await request(matches, { ...command(3, 4), revision: 2 })).statusCode).toBe(403);
    expect(await snapshot()).toBe(before);
    expect((await stored()).is_complete).toBe(true);
  });
  it('permits confirmed admin score correction while keeping the game final', async () => {
    expect((await request(matches, command())).statusCode).toBe(200);
    expect((await request(matches, { ...mapMatchFromDB(await stored()), isComplete: true, status: 'FINAL' })).statusCode).toBe(200);
    expect((await request(scoringLock, { matchId: 'journal-test', token: owner, action: 'acquire' }, 'admin', 'POST')).statusCode).toBe(200);
    expect((await request(matches, { ...command(3, 4), revision: 2 }, 'admin')).statusCode).toBe(200);
    expect((await stored()).status).toBe('FINAL'); expect((await stored()).is_complete).toBe(true);
  });
  it('rejects precompleted or malformed official game creation', async () => {
    const game = scoringFixture().game;
    for (const body of [{ ...game, id: 'bad-final', isComplete: true, status: 'FINAL' }, { ...game, id: 'bad-empty', innings: [] }])
      expect((await request(matches, body, 'umpire', 'POST')).statusCode).toBe(400);
    expect((await pool.query('SELECT id FROM matches')).rows).toHaveLength(1);
  });
  it('rolls back the pitch when saving its retry receipt fails', async () => {
    // A failure injected into the disposable fixture schema exercises a real
    // PostgreSQL rollback, without replacing pg's callback-based pool API.
    await pool.query("ALTER TABLE app_settings ADD CONSTRAINT reject_fixture_ack CHECK (key NOT LIKE 'scoring_ack:%')");
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = await snapshot();
    expect((await request(matches, command())).statusCode).toBe(500);
    expect(await snapshot()).toBe(before);
    error.mockRestore();
    await pool.query('ALTER TABLE app_settings DROP CONSTRAINT reject_fixture_ack');
  });
});
