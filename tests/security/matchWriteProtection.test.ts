import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { signSessionToken } from '../../api/auth';

// Real route handler, with only PostgreSQL mocked. Nothing touches a live DB.
const connect = vi.fn();
vi.mock('../../api/db.js', () => ({
  default: { connect: (...args: unknown[]) => connect(...args) },
}));

import matchHandler from '../../api/matches';

const blank = (points: number | null = null) => [{
  number: 1,
  home: { teamId: 'home', playerScores: [{ playerId: 'p1', pitches: [{ points }] }] },
  away: { teamId: 'away', playerScores: [] },
}];

const makeRequest = (body: Record<string, unknown>, role: 'admin' | 'umpire' = 'umpire', scoringToken?: string) => ({
  method: 'PUT',
  body: { id: 'official-game-1', revision: 5, ...body },
  headers: {
    authorization: `Bearer ${signSessionToken(role)}`,
    ...(scoringToken ? { 'x-scoring-token': scoringToken } : {}),
  },
  query: {},
});

const makeResponse = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn((data: unknown) => { res.body = data; return res; });
  res.setHeader = vi.fn();
  res.getHeader = vi.fn();
  return res;
};

describe('Match PUT protects game classification and scheduled scoring', () => {
  let query: ReturnType<typeof vi.fn>;
  let release: ReturnType<typeof vi.fn>;
  let match: Record<string, unknown>;
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', 'unit-test-only-match-write-security-secret-2026');
    match = {
      id: 'official-game-1',
      status: 'SCHEDULED',
      is_complete: false,
      is_practice: false,
      revision: '5',
      innings: blank(),
      tie_breaker: null,
    };
    query = vi.fn(async (...args: any[]) => {
      const sql = String(args[0]);
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('FROM matches') && sql.includes('FOR UPDATE')) return { rows: [match] };
      if (sql.includes('FROM scoring_locks')) return { rows: [] };
      if (sql.includes('UPDATE matches')) return { rows: [{ ...match, revision: '6' }] };
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });
    release = vi.fn();
    connect.mockResolvedValue({ query, release });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('rejects changing an official game into a deletable practice game', async () => {
    const response = makeResponse();
    await matchHandler(makeRequest({ isPractice: true, is_practice: true }) as any, response);
    expect(response.statusCode).toBe(403);
    expect(response.body.code).toBe('GAME_TYPE_LOCKED');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE matches'))).toBe(false);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects changing a practice game into an official game', async () => {
    match.is_practice = true;
    const response = makeResponse();
    await matchHandler(makeRequest({ isPractice: false, is_practice: false }, 'admin') as any, response);
    expect(response.statusCode).toBe(403);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE matches'))).toBe(false);
  });

  it('requires a scoring lock for a pitch result of zero even while SCHEDULED', async () => {
    const response = makeResponse();
    await matchHandler(makeRequest({ innings: blank(0) }) as any, response);
    expect(response.statusCode).toBe(423);
    expect(response.body.code).toBe('SCORING_LOCKED');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE matches'))).toBe(false);
  });

  it('requires a scoring lock when a scheduled update tries to erase recorded pitches', async () => {
    match.innings = blank(3);
    const response = makeResponse();
    await matchHandler(makeRequest({ innings: blank() }) as any, response);
    expect(response.statusCode).toBe(423);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE matches'))).toBe(false);
  });

  it('requires a scoring lock to submit tie-breaker results from a SCHEDULED match', async () => {
    const response = makeResponse();
    await matchHandler(makeRequest({ tieBreaker: [{ roundNumber: 1, homeScores: [2], awayScores: [0] }] }) as any, response);
    expect(response.statusCode).toBe(423);
  });

  it('preserves editing a blank scheduled lineup without requiring a scoring lock', async () => {
    const response = makeResponse();
    await matchHandler(makeRequest({ innings: blank(), isPractice: false, is_practice: false }) as any, response);
    expect(response.statusCode).toBe(200);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE matches'))).toBe(true);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });
});
