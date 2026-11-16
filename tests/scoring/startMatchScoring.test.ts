import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startMatchScoring } from '../../services/storageService';
import { memoryScoringStorage, scoringFixture } from './scoringFixtures';

describe('Dashboard scoring entry', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryScoringStorage());
    vi.stubGlobal('sessionStorage', memoryScoringStorage());
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const scheduled = () => ({ ...scoringFixture().game, status: 'SCHEDULED' as const, revision: 7 });
  const savedRow = (game: ReturnType<typeof scheduled>) => ({
    id: game.id, revision: 8, home_team_id: game.homeTeamId, away_team_id: game.awayTeamId,
    is_complete: false, is_practice: false, status: 'IN_PROGRESS', innings: game.innings, tie_breaker: [],
  });

  it('acquires access before saving and waits for confirmation before reporting a start', async () => {
    const game = scheduled(); let finish!: (r: Response) => void;
    const waiting = new Promise<Response>(resolve => { finish = resolve; });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"owned":true,"locked":true}')).mockImplementationOnce(() => waiting);
    vi.stubGlobal('fetch', fetcher);
    let confirmed = false;
    const starting = startMatchScoring(game).then(match => { confirmed = true; return match; });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls[0][0]).toBe('/api/scoring-lock');
    const access = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(access.action).toBe('acquire');
    expect(fetcher.mock.calls[1][0]).toBe('/api/matches');
    expect(fetcher.mock.calls[1][1].headers.get('X-Scoring-Token')).toBe(access.token);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ revision: 7, status: 'IN_PROGRESS' });
    expect(confirmed).toBe(false); expect(game.status).toBe('SCHEDULED');
    finish(new Response(JSON.stringify(savedRow(game))));
    expect((await starting).revision).toBe(8);
  });

  it('keeps the exact source revision of an edited lineup after acquisition', async () => {
    const base = scheduled(), edited = { ...base, notes: 'new lineup', revision: 999 };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"owned":true,"locked":true}')).mockResolvedValueOnce(new Response(JSON.stringify(savedRow(base))));
    vi.stubGlobal('fetch', fetcher);
    await startMatchScoring(edited, base);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).revision).toBe(7);
  });

  it('does not write or force takeover if another device owns the game', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"error":"Another umpire is already scoring this game."}', { status: 423 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(startMatchScoring(scheduled())).rejects.toThrow('Another umpire');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).action).toBe('acquire');
    expect(localStorage.getItem('dugout_active_match_id')).toBeNull();
  });

  it('keeps a rejected status save as a failure without rebasing or reporting success', async () => {
    const game = scheduled();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"owned":true,"locked":true}')).mockResolvedValueOnce(new Response('{"error":"Game changed on another device"}', { status: 409 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(startMatchScoring(game)).rejects.toThrow('Game changed');
    expect(game.status).toBe('SCHEDULED');
    expect(JSON.parse(fetcher.mock.calls[1][1].body).revision).toBe(7);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
