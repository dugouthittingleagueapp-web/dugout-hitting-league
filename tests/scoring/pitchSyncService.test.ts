import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  queuePitchChange, flushPitchChanges, getPendingPitchChanges, getPitchSyncConflict,
  isPitchProtected, replayPendingPitchChanges
} from '../../services/pitchSyncService';
import type { PitchChange } from '../../utils/pitchSync';
import type { Match } from '../../types';

const op: PitchChange = {
  kind: 'regulation', matchId: 'game-sync-test', inningIdx: 0, side: 'home',
  batterIdx: 0, pitchIdx: 0, playerId: 'h1', expectedPoints: null, points: 2
};
const createMatch = (): Match => ({
  id: op.matchId, league: '9U', season: '2026', date: '2026-11-11',
  homeTeamId: 'home', awayTeamId: 'away', isComplete: false, is_practice: false,
  innings: [{number:1, home:{teamId:'home',playerScores:[
    {playerId:'h1',pitches:[{points:null},{points:0}]}]},
    away:{teamId:'away',playerScores:[{playerId:'a1',pitches:[{points:null}]}]}}]
});

beforeEach(() => {
  const data: Record<string, string> = {};
  const store = {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
    removeItem: (key: string) => { delete data[key]; }
  };
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('CustomEvent', class CustomEvent {
    constructor(public type: string, public options: unknown) {}
  });
});

describe('durable offline pitch synchronization', () => {
  it('writes an operation before acknowledging the umpire tap', () => {
    const saved = queuePitchChange(op);
    expect(saved.operationId).toBeTruthy();
    expect(getPendingPitchChanges(op.matchId)).toHaveLength(1);
    expect(isPitchProtected(op.matchId)).toBe(true);
    expect(replayPendingPitchChanges(createMatch()).innings[0].home.playerScores[0].pitches[0].points).toBe(2);
  });

  it('keeps the pitch queued during a connection outage and retries later', async () => {
    queuePitchChange(op);
    await flushPitchChanges(op.matchId, async () => { throw Error('offline'); });
    expect(getPendingPitchChanges(op.matchId)).toHaveLength(1);
    localStorage.setItem('dugout_match_' + op.matchId, JSON.stringify(createMatch()));
    const send = vi.fn(async () => new Response(JSON.stringify({saved:true,rowVersion:'42'}),{status:200}));
    await flushPitchChanges(op.matchId, send);
    expect(send).toHaveBeenCalledTimes(1);
    const submitted = JSON.parse((send.mock.calls[0] as unknown as [unknown, RequestInit])[1].body as string);
    expect(submitted).toMatchObject(op);
    expect(getPendingPitchChanges(op.matchId)).toHaveLength(0);
    const cached = JSON.parse(localStorage.getItem('dugout_match_' + op.matchId)!);
    expect(cached.innings[0].home.playerScores[0].pitches[0].points).toBe(2);
    expect(cached.rowVersion).toBe('42');
  });

  it('keeps mismatched same-pitch edits for review and prevents future unsafe writes', async () => {
    queuePitchChange(op);
    const send = vi.fn(async () => new Response(JSON.stringify({error:'Pitch changed on another device. Compare scores.'}), {status:409}));
    await expect(flushPitchChanges(op.matchId, send)).rejects.toThrow('Compare scores');
    expect(getPendingPitchChanges(op.matchId)).toHaveLength(1);
    expect(getPitchSyncConflict(op.matchId)).toContain('Compare scores');
    expect(() => queuePitchChange({...op,pitchIdx:1,expectedPoints:0,points:4})).toThrow();
    await expect(flushPitchChanges(op.matchId,send)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never accepts an unpersisted tap when browser storage fails', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw Error('Quota exceeded'); } });
    expect(() => queuePitchChange(op)).toThrow('Quota exceeded');
  });
  it('does not merge a queued pitch into the wrong batter', () => {
    queuePitchChange({...op,playerId:'not-h1'});
    expect(replayPendingPitchChanges(createMatch()).innings[0].home.playerScores[0].pitches[0].points).toBeNull();
  });
});
