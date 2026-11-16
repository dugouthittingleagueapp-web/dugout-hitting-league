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

  it('does not borrow a legacy replay acknowledgement for an older foreground snapshot', async () => {
    const id = 'reconnect-serialized';
    enqueuePendingMatchSync(game(id, 1));
    let finishReplay!: (response: Response) => void;
    const first = new Promise<Response>(resolve => { finishReplay = resolve; });
    const fetcher = vi.fn().mockImplementationOnce(() => first)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Newer scores on server' }), { status: 409 }));
    vi.stubGlobal('fetch', fetcher);
    const reconnecting = syncOfflineData();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const writing = updateMatch({ ...game(id, 1), notes: 'older snapshot' }, { requireServerSave: true });
    const rejected = expect(writing).rejects.toThrow('Newer scores');
    finishReplay(new Response(JSON.stringify(savedRow(id, 2))));
    await reconnecting; await rejected;
    expect(JSON.parse(fetcher.mock.calls[1][1].body).revision).toBe(1);
    expect(localStorage.getItem('dugout_pending_sync_matches')).toBeNull();
  });

  it('retains older recovery data and rejects another snapshot when synchronization fails', async () => {
    const id = 'legacy-recovery-not-discarded';
    const older = { ...game(id, 0), tieBreaker: [{ roundNumber: 1, pitchLimit: 5, homePlayerId: 'p1', awayPlayerId: 'p2', homeScores: [4, null, null, null, null], awayScores: [null, null, null, null, null] }] };
    enqueuePendingMatchSync(older);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    await expect(updateMatch(game(id, 0))).rejects.toThrow(/only saved on this device/);
    expect(JSON.parse(localStorage.getItem('dugout_pending_sync_matches') || '{}')[id]).toEqual(older);
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
