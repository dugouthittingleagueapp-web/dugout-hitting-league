import { describe, expect, it } from 'vitest';
import { parsePitchChange, applyPitchChange, type PitchChange } from '../../utils/pitchSync';
import type { Match } from '../../types';

const match = (): Match => ({
  id: 'game-1', league: '9U', season: '2026', date: '2026-11-10',
  homeTeamId: 'home', awayTeamId: 'away', isComplete: false, is_practice: false,
  innings: [{ number: 1,
    home: { teamId: 'home', playerScores: [
      { playerId: 'h1', pitches: [{ points: null }, { points: 0 }, { points: 3 }] },
      { playerId: 'h2', pitches: [{ points: 2 }] }] },
    away: { teamId: 'away', playerScores: [{ playerId: 'a1', pitches: [{ points: null }] }] }
  }],
  tieBreaker: [{ roundNumber: 1, pitchLimit: 3,
    homePlayerId: 'h1', awayPlayerId: 'a1', homeScores: [null, 2, null], awayScores: [null, null, null] }]
});

const base: PitchChange = {
  kind: 'regulation', matchId: 'game-1', inningIdx: 0,
  side: 'home', batterIdx: 0, pitchIdx: 0, playerId: 'h1',
  expectedPoints: null, points: 4
};

describe('atomic pitch command validation', () => {
  it.each([0, 1, 2, 3, 4, null])('accepts score %s and an old null', score => {
    expect(parsePitchChange({ ...base, points: score })).toEqual({ ...base, points: score });
  });
  it('rejects missing expected value, negative indexes, forged sides, and invalid scores', () => {
    for (const invalid of [
      { ...base, points: 5 }, { ...base, points: -1 },
      { ...base, expectedPoints: undefined }, { ...base, expectedPoints: 7 },
      { ...base, batterIdx: -1 }, { ...base, inningIdx: 100 },
      { ...base, side: 'admin' }, { ...base, playerId: '' }
    ]) expect(parsePitchChange(invalid)).toBeNull();
  });
  it('rejects an out-of-range tie-breaker pitch', () => {
    expect(parsePitchChange({ ...base, kind: 'tieBreaker', roundIdx: 0, pitchIdx: 5 })).toBeNull();
  });
});

describe('offline pitch restoration', () => {
  it('preserves scored zeroes and all other innings while applying one pitch', () => {
    const m = match();
    const updated = applyPitchChange(m, base);
    expect(updated.innings[0].home.playerScores[0].pitches.map(p => p.points)).toEqual([4, 0, 3]);
    expect(m.innings[0].home.playerScores[0].pitches[0].points).toBeNull();
    expect(updated.innings[0].away).toBe(m.innings[0].away);
  });
  it('preserves a recorded score during a wrong-player lineup switch', () => {
    const m = match();
    expect(applyPitchChange(m, { ...base, playerId: 'not-the-batter' })).toBe(m);
  });
  it('replays score edits and undo in order', () => {
    const m = match();
    const scored = applyPitchChange(m, base);
    const edited = applyPitchChange(scored, { ...base, expectedPoints: 4, points: 1 });
    const undone = applyPitchChange(edited, { ...base, expectedPoints: 1, points: null });
    expect(undone.innings[0].home.playerScores[0].pitches[0].points).toBeNull();
    expect(undone.innings[0].home.playerScores[0].pitches[1].points).toBe(0);
  });
  it('handles tie breaker edits without touching regulation data', () => {
    const m = match();
    const c: PitchChange = {
      kind: 'tieBreaker', matchId: 'game-1', roundIdx: 0, side: 'away',
      pitchIdx: 1, playerId: 'a1', expectedPoints: null, points: 2
    };
    const edited = applyPitchChange(m, c);
    expect(edited.tieBreaker?.[0].awayScores[1]).toBe(2);
    expect(edited.innings).toBe(m.innings);
    expect(edited.tieBreaker?.[0].homeScores).toBe(m.tieBreaker?.[0].homeScores);
  });
});
