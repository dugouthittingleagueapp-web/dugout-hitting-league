import { describe, expect, it } from 'vitest';
import { getLiveInningIndex } from '../../utils/liveInning';
import type { Match, Inning } from '../../types';

const inning = (number: number, scored: boolean): Inning => ({
  number,
  home: { teamId: 'home', playerScores: [{ playerId: 'p1', pitches: [{ points: scored ? 2 : null }] }] },
  away: { teamId: 'away', playerScores: [{ playerId: 'p2', pitches: [{ points: scored ? 1 : null }] }] },
});
const match = (innings: Inning[], tieBreaker?: Match['tieBreaker']): Match => ({
  id: 'game', league: '11U', season: '2026', homeTeamId: 'home',
  awayTeamId: 'away', date: '2026-11-11', isComplete: false,
  is_practice: false, innings, tieBreaker,
});

describe('Spectator live inning selection', () => {
  it('moves to the earliest inning with an unscored pitch', () => {
    const innings = Array.from({ length: 6 }, (_, i) => inning(i + 1, i < 3));
    expect(getLiveInningIndex(match(innings))).toBe(3);
    innings[3].away.playerScores[0].pitches[0].points = 1;
    expect(getLiveInningIndex(match(innings))).toBe(3);
  });

  it('uses the sixth inning after all regulation innings have scores', () => {
    const innings = Array.from({ length: 6 }, (_, i) => inning(i + 1, true));
    expect(getLiveInningIndex(match(innings))).toBe(5);
  });

  it('selects the tie-breaker tab when the tie-breaker exists', () => {
    const innings = Array.from({ length: 6 }, (_, i) => inning(i + 1, true));
    expect(getLiveInningIndex(match(innings, [{
      roundNumber: 1, pitchLimit: 5, homePlayerId: 'p1', awayPlayerId: 'p2',
      homeScores: [], awayScores: [],
    }]))).toBe(6);
  });
});
