import { describe, it, expect } from 'vitest';
import { applyLineupToMatch, moveBatterUp, moveBatterDown } from '../../utils/lineupHelper';
import { Match, Inning } from '../../types';

describe('lineupHelper', () => {
  const createMockMatch = (homePids: string[], awayPids: string[]): Match => {
    const innings: Inning[] = [];
    for (let i = 1; i <= 6; i++) {
      innings.push({
        number: i,
        home: {
          teamId: 'home',
          playerScores: homePids.map(id => ({
            playerId: id,
            pitches: Array(10).fill(null).map(() => ({ points: null }))
          }))
        },
        away: {
          teamId: 'away',
          playerScores: awayPids.map(id => ({
            playerId: id,
            pitches: Array(10).fill(null).map(() => ({ points: null }))
          }))
        }
      });
    }

    return {
      id: 'match-1',
      league: '9U 3v3',
      season: '2026',
      homeTeamId: 'home-team',
      awayTeamId: 'away-team',
      date: '2026-11-02T19:00:00.000Z',
      isComplete: false,
      innings
    };
  };

  describe('moveBatterUp and moveBatterDown', () => {
    it('moves batter up in batting order correctly', () => {
      const initial = ['p1', 'p2', 'p3'];
      const moved = moveBatterUp(initial, 2); // move p3 up to slot 1
      expect(moved).toEqual(['p1', 'p3', 'p2']);

      const movedToFirst = moveBatterUp(moved, 1); // move p3 up to slot 0
      expect(movedToFirst).toEqual(['p3', 'p1', 'p2']);

      // Boundaries
      expect(moveBatterUp(initial, 0)).toEqual(['p1', 'p2', 'p3']);
    });

    it('moves batter down in batting order correctly', () => {
      const initial = ['p1', 'p2', 'p3'];
      const moved = moveBatterDown(initial, 0); // move p1 down to slot 1
      expect(moved).toEqual(['p2', 'p1', 'p3']);

      // Boundaries
      expect(moveBatterDown(initial, 2)).toEqual(['p1', 'p2', 'p3']);
    });
  });

  describe('applyLineupToMatch', () => {
    it('updates batting order across all 6 innings', () => {
      const match = createMockMatch(['h1', 'h2', 'h3'], ['a1', 'a2', 'a3']);
      const reorderedHome = ['h3', 'h1', 'h2'];
      const reorderedAway = ['a2', 'a3', 'a1'];

      const updated = applyLineupToMatch(match, reorderedHome, reorderedAway);

      expect(updated.innings).toHaveLength(6);
      updated.innings.forEach(inning => {
        expect(inning.home.playerScores.map(p => p.playerId)).toEqual(['h3', 'h1', 'h2']);
        expect(inning.away.playerScores.map(p => p.playerId)).toEqual(['a2', 'a3', 'a1']);
        expect(inning.home.playerScores[0].pitches).toHaveLength(10);
        expect(inning.away.playerScores[0].pitches).toHaveLength(10);
      });
    });

    it('preserves existing scores while reordering batters', () => {
      const match = createMockMatch(['h1', 'h2', 'h3'], ['a1', 'a2', 'a3']);
      // Give h3 some points in inning 1
      match.innings[0].home.playerScores[2].pitches[0].points = 4;
      match.innings[0].home.playerScores[2].pitches[1].points = 2;

      // Swap h3 into Batter 1 (lead-off)
      const updated = applyLineupToMatch(match, ['h3', 'h1', 'h2'], ['a1', 'a2', 'a3']);

      // h3 is now in index 0
      expect(updated.innings[0].home.playerScores[0].playerId).toBe('h3');
      expect(updated.innings[0].home.playerScores[0].pitches[0].points).toBe(4);
      expect(updated.innings[0].home.playerScores[0].pitches[1].points).toBe(2);
    });

    it('handles 2-player Ghost Mode pitch allocations (15 pitches for 2 players vs 3)', () => {
      const match = createMockMatch(['h1', 'h2', 'h3'], ['a1', 'a2', 'a3']);
      // Away team has 2 players, Home team has 3
      const updated = applyLineupToMatch(match, ['h1', 'h2', 'h3'], ['a1', 'a2']);

      updated.innings.forEach(inning => {
        expect(inning.away.playerScores).toHaveLength(2);
        expect(inning.away.playerScores[0].pitches).toHaveLength(15);
        expect(inning.away.playerScores[1].pitches).toHaveLength(15);

        expect(inning.home.playerScores).toHaveLength(3);
        expect(inning.home.playerScores[0].pitches).toHaveLength(10);
      });
    });
  });
});
