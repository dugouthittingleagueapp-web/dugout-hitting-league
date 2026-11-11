import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../api/db.js', () => ({ default: { query } }));

import matchesHandler from '../../api/matches';
import teamsHandler from '../../api/teams';

type MockResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body?: unknown;
  ended: boolean;
  status: (code: number) => MockResponse;
  json: (body: unknown) => MockResponse;
  end: () => MockResponse;
  setHeader: (key: string, value: string) => MockResponse;
};

const response = (): MockResponse => {
  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    ended: false,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
    end() { res.ended = true; return res; },
    setHeader(key, value) { res.headers[key.toLowerCase()] = value; return res; }
  };
  return res;
};

describe('Spectator network efficiency endpoints', () => {
  beforeEach(() => query.mockReset());

  it('returns no game history when the spectator already has the current revision', async () => {
    query.mockResolvedValueOnce({ rows: [{ revision: 7 }] });
    const res = response();
    await matchesHandler({ method: 'GET', query: { id: 'game-1', spectatorRevision: '7' } } as any, res as any);
    expect(res.statusCode).toBe(304);
    expect(res.ended).toBe(true);
    expect(res.body).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('SELECT revision FROM matches');
  });

  it('returns full innings and the new revision when a game changes', async () => {
    const innings = [{ number: 1, home: { playerScores: [] }, away: { playerScores: [] } }];
    query.mockResolvedValueOnce({ rows: [{ revision: 8 }] });
    query.mockResolvedValueOnce({ rows: [{ id: 'game-1', revision: 8, innings, is_forfeit: false }] });
    const res = response();
    await matchesHandler({ method: 'GET', query: { id: 'game-1', spectatorRevision: '7' } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).revision).toBe(8);
    expect((res.body as any).innings).toEqual(innings);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('fetches the full game on first load and never treats malformed revision as valid', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'game-1', revision: 0, innings: [] }] });
    const res = response();
    await matchesHandler({ method: 'GET', query: { id: 'game-1', spectatorRevision: 'not-a-number' } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('SELECT * FROM matches');
  });

  it('restricts roster queries to the two teams playing', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'home' }, { id: 'away' }] });
    const res = response();
    await teamsHandler({ method: 'GET', query: { ids: 'home,away' } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ id: 'home' }, { id: 'away' }]);
    expect(query.mock.calls[0][0]).toContain('id = ANY');
    expect(query.mock.calls[0][1]).toEqual([['home', 'away']]);
  });

  it('rejects an overly broad roster selection instead of fetching every team', async () => {
    const res = response();
    await teamsHandler({ method: 'GET', query: { ids: 'a,b,c' } } as any, res as any);
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});
