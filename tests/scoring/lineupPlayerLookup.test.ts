import { describe, expect, it } from 'vitest';
import type { Team } from '../../types';
import { resolveLineupPlayer } from '../../utils/lineupPlayerLookup';
import { moveBatterUp, moveBatterDown } from '../../utils/lineupHelper';

const home: Team = {
  id: 'home', name: 'Home', league: '11U', season: '2026',
  players: [
    { id: 'player-1', name: 'Jordan', lastName: 'Smith' },
    { id: 'player-2', name: 'Sam', lastName: 'Jones' },
  ],
  subs: [{ id: 'sub-3', name: 'Pat', lastName: 'Taylor' }],
};
const away: Team = {
  id: 'away', name: 'Away', league: '11U', season: '2026',
  players: [{ id: 'away-1', name: 'Jordan', lastName: 'Smith' }],
};

describe('Lineup identity display and ordering', () => {
  it('prefers exact IDs before names, including registered substitutes', () => {
    expect(resolveLineupPlayer('player-1', home, home, away)?.id).toBe('player-1');
    expect(resolveLineupPlayer('sub-3', home, home, away)?.id).toBe('sub-3');
    expect(resolveLineupPlayer('away-1', home, home, away)?.id).toBe('away-1');
  });

  it('supports older case-insensitive IDs, first names, full names, and initials', () => {
    expect(resolveLineupPlayer(' PLAYER-2 ', home, home, away)?.id).toBe('player-2');
    expect(resolveLineupPlayer('sam', home, home, away)?.id).toBe('player-2');
    expect(resolveLineupPlayer('Jordan Smith', home, home, away)?.id).toBe('player-1');
    expect(resolveLineupPlayer('Pat T.', home, home, away)?.id).toBe('sub-3');
    expect(resolveLineupPlayer('nonexistent', home, home, away)).toBeUndefined();
    expect(resolveLineupPlayer('  ', home, home, away)).toBeUndefined();
  });

  it('moves batters without mutating saved order or introducing duplicate IDs', () => {
    const initial = ['player-1', 'player-2', 'sub-3'];
    expect(moveBatterUp(initial, 1)).toEqual(['player-2', 'player-1', 'sub-3']);
    expect(moveBatterDown(initial, 1)).toEqual(['player-1', 'sub-3', 'player-2']);
    expect(moveBatterUp(initial, 0)).toEqual(initial);
    expect(moveBatterDown(initial, 2)).toEqual(initial);
    expect(initial).toEqual(['player-1', 'player-2', 'sub-3']);
  });
});
