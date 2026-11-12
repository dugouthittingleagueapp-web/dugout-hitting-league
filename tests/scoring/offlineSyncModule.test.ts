import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOfflineSynchronizer,
  enqueuePendingMatchSync,
  enqueuePendingTeamSync,
  getScoringSyncWarning,
} from '../../services/offlineSync';
import type { Match, Team } from '../../types';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const game = (id: string, revision = 3): Match => ({
  id, revision, league: '11U', season: '2026',
  homeTeamId: 'home', awayTeamId: 'away', date: '2026-11-11',
  status: 'IN_PROGRESS', isComplete: false, is_practice: false, innings: [],
});

const responseRow = (id: string, revision: number) => ({
  id, revision, league: '11U', season: '2026',
  home_team_id: 'home', away_team_id: 'away', date: '2026-11-11',
  is_complete: false, is_practice: false, innings: [],
});

describe('Isolated offline synchronizer', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const dependencies = (apiFetch: (url: string, init?: RequestInit) => Promise<Response>) => ({
    apiFetch,
    serializeMatchOperation: async <T>(_id: string, operation: () => Promise<T>): Promise<T> => operation(),
    matchWriteHeaders: (_id: string): HeadersInit => ({ 'Content-Type': 'application/json' }),
    recordRevision: (match: Match): Match => match,
  });

  it('shares one reconnect pass and sends each pending team once', async () => {
    const team: Team = { id: 'team-1', name: 'Tigers', league: '11U', season: '2026', players: [] };
    enqueuePendingTeamSync(team);
    let finish!: (value: Response) => void;
    const waiting = new Promise<Response>(resolve => { finish = resolve; });
    const apiFetch = vi.fn(async () => waiting);
    const reconnect = createOfflineSynchronizer(dependencies(apiFetch));

    const first = reconnect();
    const second = reconnect();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    finish(new Response('{}'));
    await Promise.all([first, second]);

    expect(localStorage.getItem('dugout_pending_sync_teams')).toBeNull();
    expect(apiFetch.mock.calls[0][0]).toBe('/api/teams');
  });

  it('preserves the latest local scores if a newer snapshot appears during replay', async () => {
    const id = 'scores-while-syncing';
    const earlier = game(id, 3);
    enqueuePendingMatchSync(earlier);
    let finish!: (value: Response) => void;
    const waiting = new Promise<Response>(resolve => { finish = resolve; });
    const apiFetch = vi.fn(async () => waiting);
    const reconnect = createOfflineSynchronizer(dependencies(apiFetch));

    const replay = reconnect();
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const newer = { ...earlier, notes: 'another pitch recorded on this phone' };
    enqueuePendingMatchSync(newer);
    finish(new Response(JSON.stringify(responseRow(id, 4))));
    await replay;

    const queued = JSON.parse(localStorage.getItem('dugout_pending_sync_matches') || '{}');
    expect(queued[id]).toEqual(newer);
    expect(getScoringSyncWarning(id)).toContain('still saved on this device');
    expect(localStorage.getItem(`dugout_match_${id}`)).toBeNull();
  });

  it('retains queued teams on a temporary HTTP error so retry is possible', async () => {
    enqueuePendingTeamSync({ id: 'team-2', name: 'Bears', league: '11U', season: '2026', players: [] });
    const apiFetch = vi.fn(async () => new Response('temporary error', { status: 503 }));
    const reconnect = createOfflineSynchronizer(dependencies(apiFetch));
    await reconnect();
    expect(JSON.parse(localStorage.getItem('dugout_pending_sync_teams') || '{}')['team-2']).toBeDefined();
  });
});
