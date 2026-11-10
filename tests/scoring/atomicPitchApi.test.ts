import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../api/db', () => ({ default: db }));
vi.mock('../../api/auth', () => ({ requireRole: () => 'umpire' }));
import handler from '../../api/pitch';

const change = {
  kind: 'regulation', matchId: 'game-concurrent', inningIdx: 2, side: 'home',
  batterIdx: 0, pitchIdx: 6, playerId: 'batter-1', expectedPoints: null, points: 2
};

const response = () => {
  const res: any = {};
  res.status = vi.fn((status: number) => { res.code = status; return res; });
  res.json = vi.fn((data: unknown) => { res.body = data; return res; });
  return res;
};

beforeEach(() => db.query.mockReset());

describe('atomic SQL pitch API', () => {
  it('writes only the targeted pitch with atomic current-score and batter guards', async () => {
    db.query.mockResolvedValueOnce({rowCount:1,rows:[{id:change.matchId,row_version:'72'}]});
    const res = response();
    await handler({method:'PATCH',body:change} as any, res);
    expect(res.code).toBe(200);
    expect(res.body).toEqual({saved:true,rowVersion:'72'});
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('jsonb_set(innings');
    expect(sql).toContain('IS NOT DISTINCT FROM');
    expect(sql).toContain('AND (innings #>> $6::text[]) = $7::text');
    expect(sql).toContain("AND (innings #> $3::text[]) IS NOT NULL");
    expect(sql).not.toContain('SET innings = $');
    expect(params[2]).toEqual(['2','home','playerScores','0','pitches','6','points']);
    expect(params[4]).toBeNull();
    expect(params[5]).toEqual(['2','home','playerScores','0','playerId']);
    expect(params[6]).toBe('batter-1');
  });
  it('does not overwrite a same-pitch edit from a second umpire', async () => {
    db.query.mockResolvedValueOnce({rowCount:0,rows:[]})
      .mockResolvedValueOnce({rowCount:1,rows:[{id:change.matchId,is_complete:false}]});
    const res = response();
    await handler({method:'PATCH',body:{...change,points:4}} as any,res);
    expect(res.code).toBe(409);
    expect(String(res.body.error)).toContain('another device');
    expect(db.query).toHaveBeenCalledTimes(2);
  });
  it('selects just the tie-breaker pitch, not all regulation innings', async () => {
    db.query.mockResolvedValueOnce({rowCount:1,rows:[{id:change.matchId,row_version:'73'}]});
    const res = response();
    await handler({method:'PATCH',body:{
      ...change,kind:'tieBreaker',roundIdx:1,pitchIdx:0,side:'away',playerId:'a1'
    }} as any,res);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('jsonb_set(tie_breaker');
    expect(params[2]).toEqual(['1','awayScores','0']);
    expect(params[5]).toEqual(['1','awayPlayerId']);
    expect(res.code).toBe(200);
  });
  it('rejects out-of-bounds pitches without touching the database', async () => {
    const res = response();
    await handler({method:'PATCH',body:{...change,points:99}} as any,res);
    expect(res.code).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
  it('does not create missing pitches or revive a finalized game for umpires', async () => {
    db.query.mockResolvedValueOnce({rowCount:0,rows:[]})
      .mockResolvedValueOnce({rowCount:1,rows:[{id:change.matchId,is_complete:true}]});
    const res = response();
    await handler({method:'PATCH',body:change} as any,res);
    expect(res.code).toBe(403);
  });
});
