import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../api/db.js', () => ({ default: { query } }));

import deltaHandler from '../../api/matches-delta';

const response = () => {
  const res = {
    statusCode: 200, body: undefined as any, headers: {} as Record<string, string>,
    status(code: number) { res.statusCode = code; return res; },
    json(body: any) { res.body = body; return res; },
    setHeader(key: string, value: string) { res.headers[key.toLowerCase()] = value; return res; }
  };
  return res;
};

const post = (versions: Record<string, number>, other: Record<string, unknown> = {}) => ({
  method: 'POST',
  body: { league: '11U', season: '2026', excludePractice: false, versions, ...other }
});

describe('Incremental dashboard refresh', () => {
  beforeEach(() => query.mockReset());

  it('returns only the game that changed, and names games removed from the schedule', async () => {
    query.mockResolvedValueOnce({ rows: [
      { id: 'game-a', revision: 3, is_practice: false },
      { id: 'game-b', revision: 8, is_practice: false }
    ] });
    query.mockResolvedValueOnce({ rows: [{
      id: 'game-a', revision: 3, is_practice: false, innings: [{ number: 1 }]
    }] });
    const res = response();
    await deltaHandler(post({ 'game-a': 2, 'game-b': 8, 'game-removed': 1 }) as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body.changed.map((m: any) => m.id)).toEqual(['game-a']);
    expect(res.body.removedIds).toEqual(['game-removed']);
    expect(res.body.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1]).toEqual([['game-a']]);
  });

  it('uses a lightweight query only when no game has changed', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'game-b', revision: 8, is_practice: false }] });
    const res = response();
    await deltaHandler(post({ 'game-b': 8 }) as any, res as any);
    expect(res.body.changed).toEqual([]);
    expect(res.body.removedIds).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('SELECT id, revision, is_practice');
  });

  it('keeps practice IDs and exclusion rules consistent with the full schedule', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'game-practice', revision: 1, is_practice: true }] });
    query.mockResolvedValueOnce({ rows: [{ id: 'game-practice', revision: 1, is_practice: true, innings: [] }] });
    const res = response();
    await deltaHandler(post({}) as any, res as any);
    expect(res.body.changed[0].id).toBe('practice-game-practice');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not accept malformed version maps or unsupported methods', async () => {
    const bad = response();
    await deltaHandler(post({ game: -1 }) as any, bad as any);
    expect(bad.statusCode).toBe(400);
    const wrongMethod = response();
    await deltaHandler({ method: 'GET' } as any, wrongMethod as any);
    expect(wrongMethod.statusCode).toBe(405);
    expect(query).not.toHaveBeenCalled();
  });
});
