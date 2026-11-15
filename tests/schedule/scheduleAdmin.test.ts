import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { signSessionToken } from '../../api/auth';
import { mapMatchFromDB } from '../../utils/dbMappers';

const connect = vi.fn();
vi.mock('../../api/db.js', () => ({ default: { connect: (...args: unknown[]) => connect(...args) } }));
import handler from '../../api/schedule-admin';

const draft = {
  action: 'update_game', id: 'game-1', season: '2027', revision: 5,
  date: '2027-11-01', startTime: '6:00 pm', endTime: '7:00 pm',
  location: 'The Dugout: Tunnels 5/6', notes: 'Bring spare balls', homeTeamId: 'home', awayTeamId: 'away',
};

describe('Schedule edit API (PostgreSQL mocked; no live database)', () => {
  let row: any;
  let query: any;
  let release: any;
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', 'unit-test-only-schedule-session-secret-2027');
    row = { id: 'game-1', season: '2027', league: '11U', revision: 5, status: 'SCHEDULED',
      is_complete: false, innings: [], tie_breaker: null, home_team_id: 'home', away_team_id: 'away', notes: 'Bring spare balls' };
    query = vi.fn(async (sql: string, params?: any[]) => {
      if (['BEGIN', 'ROLLBACK', 'COMMIT'].includes(sql)) return { rows: [] };
      if (sql.includes('FROM app_settings')) return { rows: [{ value: '2027' }] };
      if (sql.includes('FROM matches')) return { rows: [row] };
      if (sql.includes('FROM teams')) return { rows: [{ id: 'home' }, { id: 'away' }] };
      if (sql.includes('UPDATE matches')) {
        row = { ...row, date: params![1], start_time: params![2], end_time: params![3], location: params![4], notes: params![5], revision: 6 };
        return { rows: [{ id: row.id, revision: row.revision }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    release = vi.fn();
    connect.mockResolvedValue({ query, release });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  const request = async (changes: Record<string, unknown> = {}) => {
    const res: any = { statusCode: 200 };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: unknown) => { res.body = body; return res; };
    res.setHeader = vi.fn();
    await handler({ method: 'PATCH', body: { ...draft, ...changes }, headers: { authorization: `Bearer ${signSessionToken('admin')}` } } as any, res);
    return res;
  };

  it('preserves a note through load, edit, save and reload of another field', async () => {
    const loaded = mapMatchFromDB(row);
    const res = await request({ notes: loaded.notes, startTime: '6:15 pm' });
    expect(res.statusCode).toBe(200);
    expect(mapMatchFromDB(row)).toMatchObject({ notes: 'Bring spare balls', startTime: '6:15 pm' });
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    { date: '2027-02-30' }, { startTime: '25:00' }, { endTime: '5:00 pm' }, { endTime: '18:00' },
  ])('rejects invalid edits before any update: %j', async changes => {
    const res = await request(changes);
    expect(res.statusCode).toBe(400);
    expect(query.mock.calls.some(([sql]: [string]) => sql.includes('UPDATE matches'))).toBe(false);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('still protects a recorded zero from a schedule edit', async () => {
    row.innings = [{ number: 1, home: { playerScores: [{ pitches: [{ points: 0 }] }] } }];
    const res = await request();
    expect(res.statusCode).toBe(409);
    expect(query.mock.calls.some(([sql]: [string]) => sql.includes('UPDATE matches'))).toBe(false);
  });
});
