import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueuePendingMatchSync, syncOfflineData, updateMatch } from '../../services/storageService';
import type { Match } from '../../types';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); }
  };
};
const game = (id: string, revision: number): Match => ({
  id, revision, league: '11U', season: '2026', homeTeamId: 'home',
  awayTeamId: 'away', date: '2026-11-11', status: 'IN_PROGRESS',
  isComplete: false, is_practice: false, innings: []
});
const savedRow = (id: string, revision: number) => ({
  id, revision, league: '11U', season: '2026', home_team_id: 'home',
  away_team_id: 'away', date: '2026-11-11', status: 'IN_PROGRESS',
  is_complete: false, is_practice: false, innings: []
});

describe('Offline reconnect safety', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('serializes reconnect replay before the next live score and uses the latest revision', async () => {
    const id = 'reconnect-serialized';
    const offlineScore = game(id, 1);
    enqueuePendingMatchSync(offlineScore);
    let finishReplay!: (response: Response) => void;
    const first = new Promise<Response>(resolve => { finishReplay = resolve; });
    const fetcher = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(savedRow(id, 3)))));
    vi.stubGlobal('fetch', fetcher);

    const reconnecting = syncOfflineData();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const newPitch = { ...game(id, 1), notes: 'next pitch' };
    const writing = updateMatch(newPitch, { requireServerSave: true });
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);

    finishReplay(new Response(JSON.stringify(savedRow(id, 2))));
    await reconnecting;
    const saved = await writing;
    expect(saved.revision).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetcher.mock.calls[1][1].body as string);
    expect(body.revision).toBe(2);
    expect(localStorage.getItem('dugout_pending_sync_matches')).toBeNull();
  });

  it('clears an older queued pitch when a newer successful save includes it', async () => {
    const id = 'reconnect-newer-score';
    const inning = {
      number: 1,
      home: { teamId: 'home', playerScores: [{ playerId: 'p1', pitches: [{ points: 2 }, { points: null }] }] },
      away: { teamId: 'away', playerScores: [{ playerId: 'p2', pitches: [{ points: null }] }] }
    };
    const first = { ...game(id, 0), innings: [inning] };
    const second = {
      ...game(id, 0),
      innings: [{
        ...inning,
        home: { ...inning.home, playerScores: [{
          playerId: 'p1', pitches: [{ points: 2 }, { points: 3 }]
        }] }
      }]
    };
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('Wi-Fi disconnected'))
      .mockResolvedValueOnce(new Response(JSON.stringify(savedRow(id, 1))));
    vi.stubGlobal('fetch', fetcher);
    await updateMatch(first);
    expect(JSON.parse(localStorage.getItem('dugout_pending_sync_matches') || '{}')[id]).toBeTruthy();
    await updateMatch(second);
    expect(localStorage.getItem('dugout_pending_sync_matches')).toBeNull();
    expect(JSON.parse(localStorage.getItem('dugout_scoring_sync_conflicts') || '{}')[id]).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('preserves unsent pitches and warns when the server rejects a stale offline snapshot', async () => {
    const id = 'reconnect-conflict';
    enqueuePendingMatchSync(game(id, 4));
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ code: 'STALE_MATCH' }), { status: 409 })
    ));
    await syncOfflineData();
    const pending = JSON.parse(localStorage.getItem('dugout_pending_sync_matches') || '{}');
    const warnings = JSON.parse(localStorage.getItem('dugout_scoring_sync_conflicts') || '{}');
    expect(pending[id].revision).toBe(4);
    expect(warnings[id]).toContain('Ask an admin');
  });
});
