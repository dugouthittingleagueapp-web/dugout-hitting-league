import { describe, it, expect } from 'vitest';
import { 
  applyLineupToMatch, 
  moveBatterUp, 
  moveBatterDown, 
  formatFullPlayerName,
  getMatchStatus,
  swapHomeAndAway,
  findCurrentOrUpcomingWeekId
} from '../../utils/lineupHelper';
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
      is_practice: false,
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

  describe('formatFullPlayerName', () => {
    it('formats first and last name in full', () => {
      expect(formatFullPlayerName({ name: 'Charlie', lastName: 'Washington' })).toBe('Charlie Washington');
    });

    it('handles player with no last name', () => {
      expect(formatFullPlayerName({ name: 'Babe' })).toBe('Babe');
    });

    it('avoids duplicating if name already includes last name', () => {
      expect(formatFullPlayerName({ name: 'Derek Jeter', lastName: 'Jeter' })).toBe('Derek Jeter');
    });

    it('handles undefined or empty names safely', () => {
      expect(formatFullPlayerName(undefined)).toBe('Unknown Player');
      expect(formatFullPlayerName({ name: '' })).toBe('Unknown Player');
    });
  });

  describe('getMatchStatus', () => {
    it('returns FINAL if match is marked complete', () => {
      const match = createMockMatch(['h1', 'h2', 'h3'], ['a1', 'a2', 'a3']);
      match.isComplete = true;
      expect(getMatchStatus(match)).toBe('FINAL');
    });

    it('returns IN_PROGRESS if status is set to IN_PROGRESS', () => {
      const match = createMockMatch(['h1', 'h2', 'h3'], ['a1', 'a2', 'a3']);
      match.status = 'IN_PROGRESS';
      expect(getMatchStatus(match)).toBe('IN_PROGRESS');
    });

    it('returns SCHEDULED if status is set to SCHEDULED', () => {
      const match = createMockMatch(['h1', 'h2', 'h3'], ['a1', 'a2', 'a3']);
      match.status = 'SCHEDULED';
      expect(getMatchStatus(match)).toBe('SCHEDULED');
    });

    it('detects legacy unstarted vs started match when status is not present', () => {
      const match = createMockMatch(['h1', 'h2', 'h3'], ['a1', 'a2', 'a3']);
      // No status, no pitches
      expect(getMatchStatus(match)).toBe('SCHEDULED');

      // Record 1 pitch
      match.innings[0].home.playerScores[0].pitches[0].points = 3;
      expect(getMatchStatus(match)).toBe('IN_PROGRESS');
    });
  });

  describe('swapHomeAndAway', () => {
    it('swaps home and away team IDs and inning player scores', () => {
      const match = createMockMatch(['h1', 'h2', 'h3'], ['a1', 'a2', 'a3']);
      match.homeTeamId = 'team-red';
      match.awayTeamId = 'team-blue';

      const swapped = swapHomeAndAway(match);

      expect(swapped.homeTeamId).toBe('team-blue');
      expect(swapped.awayTeamId).toBe('team-red');

      // First inning checks
      expect(swapped.innings[0].home.playerScores.map(p => p.playerId)).toEqual(['a1', 'a2', 'a3']);
      expect(swapped.innings[0].away.playerScores.map(p => p.playerId)).toEqual(['h1', 'h2', 'h3']);
    });
  });

  describe('findCurrentOrUpcomingWeekId', () => {
    it('selects active week if a match is IN_PROGRESS', () => {
      const activeMatch = createMockMatch(['h1'], ['a1']);
      activeMatch.status = 'IN_PROGRESS';

      const weeks = [
        { id: '2026-W40', label: 'Week 1', matches: [createMockMatch(['h1'], ['a1'])] },
        { id: '2026-W41', label: 'Week 2', matches: [activeMatch] }
      ];

      expect(findCurrentOrUpcomingWeekId(weeks, '2026-10-01T00:00:00Z')).toBe('2026-W41');
    });

    it('returns current week if matches today', () => {
      const weeks = [
        { id: '2026-W45', label: 'Week 1', matches: [createMockMatch(['h1'], ['a1'])] },
        { id: '2026-W46', label: 'Week 2', matches: [createMockMatch(['h1'], ['a1'])] }
      ];
      // 2026-11-03 is in 2026-W45
      expect(findCurrentOrUpcomingWeekId(weeks, '2026-11-03T12:00:00Z')).toBe('2026-W45');
    });
  });
});


