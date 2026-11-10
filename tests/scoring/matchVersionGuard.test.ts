import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../api/db', () => ({ default: db }));
vi.mock('../../api/auth', () => ({
  requireRole: () => 'umpire',
  getAuthFromRequest: () => ({authenticated:true,role:'umpire'})
}));
import handler from '../../api/matches';

const match = {
  id: 'game-1', league: '9U', homeTeamId:'h',awayTeamId:'a',season:'2026',
  isComplete:false,innings:[],tieBreaker:[],rowVersion:'6'
};
const response = () => {
  const res: any = {};
  res.status = vi.fn((code:number) => {res.code=code;return res;});
  res.json = vi.fn((body:unknown) => {res.body=body;return res;});
  return res;
};

beforeEach(() => db.query.mockReset());

describe('whole-match optimistic concurrency', () => {
  it('rejects an old browser without a row version instead of silently overwriting scores', async () => {
    const res = response();
    await handler({method:'PUT',body:{...match,rowVersion:undefined}} as any,res);
    expect(res.code).toBe(428);
    expect(res.body.error).toContain('Reopen');
    expect(db.query).not.toHaveBeenCalled();
  });
  it('returns 409 when another device changed the match first', async () => {
    db.query.mockResolvedValueOnce({rowCount:0,rows:[]})
      .mockResolvedValueOnce({rowCount:1,rows:[{id:match.id}]});
    const res = response();
    await handler({method:'PUT',body:match} as any,res);
    expect(res.code).toBe(409);
    expect(res.body.error).toContain('Nothing was overwritten');
    const [sql,params] = db.query.mock.calls[0];
    expect(sql).toContain('xmin::text = $19::text');
    expect(params[18]).toBe('6');
  });
  it('responds with the updated row version when an authorized full save succeeds', async () => {
    db.query.mockResolvedValueOnce({rowCount:1,rows:[{
      id:match.id,innings:[],tie_breaker:[],row_version:'7',is_forfeit:false
    }]});
    const res = response();
    await handler({method:'PUT',body:match} as any,res);
    expect(res.code).toBe(200);
    expect(res.body.row_version).toBe('7');
  });
});
