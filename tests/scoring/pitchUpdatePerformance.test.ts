import { describe, expect, it } from 'vitest';
import type { Match } from '../../types';
import { withPitchScore } from '../../utils/pitchUpdate';

const buildMatch = (): Match => {
  const inning = (number: number) => ({
    number,
    home: { teamId: 'home', playerScores: [
      { playerId: 'h1', pitches: [{ points: null }, { points: null }] },
      { playerId: 'h2', pitches: [{ points: null }, { points: null }] }
    ] },
    away: { teamId: 'away', playerScores: [
      { playerId: 'a1', pitches: [{ points: null }, { points: null }] }
    ] }
  });
  return {
    id: 'game-1', league: '12U', season: '2026',
    homeTeamId: 'home', awayTeamId: 'away', date: '2026-11-11',
    isComplete: false, status: 'SCHEDULED', is_practice: false,
    innings: [inning(1), inning(2)]
  };
};

describe('Immutable pitch update', () => {
  it('updates one pitch while preserving the previous snapshot and unrelated innings', () => {
    const before = buildMatch();
    const after = withPitchScore(before, 0, 'home', 0, 0, 3);
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.innings[0].home.playerScores[0].pitches[0].points).toBe(3);
    expect(before.innings[0].home.playerScores[0].pitches[0].points).toBeNull();
    expect(after.innings[1]).toBe(before.innings[1]);
    expect(after.innings[0].away).toBe(before.innings[0].away);
    expect(after.innings[0].home.playerScores[1]).toBe(before.innings[0].home.playerScores[1]);
    expect(after.innings[0].home.playerScores[0]).not.toBe(before.innings[0].home.playerScores[0]);
    const second = withPitchScore(after, 0, 'home', 0, 1, 4);
    expect(after.innings[0].home.playerScores[0].pitches[1].points).toBeNull();
    expect(second.innings[0].home.playerScores[0].pitches.map(p => p.points)).toEqual([3, 4]);
  });

  it('does not alter completed game status when making an authorized correction', () => {
    const before = { ...buildMatch(), isComplete: true, status: 'FINAL' as const };
    const after = withPitchScore(before, 0, 'away', 0, 0, 2);
    expect(after.status).toBe('FINAL');
    expect(after.innings[0].away.playerScores[0].pitches[0].points).toBe(2);
  });
});
