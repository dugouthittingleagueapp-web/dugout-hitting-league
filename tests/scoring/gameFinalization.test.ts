import { describe, expect, it } from 'vitest';
import type { Match, Team, TieBreakerRound } from '../../types';
import {
  appendTieBreakerRound, createNextTieBreakerRound, getFinalizationDecision,
  getFinalizationMessage, prepareFinalizedMatch
} from '../../utils/gameFinalization';

const fixture = (homePoints = 3, awayPoints = 2, options: Partial<Match> = {}): Match => ({
  id: 'game-1', league: '11U', season: '2026', homeTeamId: 'home', awayTeamId: 'away',
  date: '2026-11-11', isComplete: false, status: 'IN_PROGRESS', is_practice: false,
  innings: [{
    number: 1,
    home: { teamId: 'home', playerScores: [{ playerId: 'a', pitches: [{ points: homePoints }] }] },
    away: { teamId: 'away', playerScores: [{ playerId: 'b', pitches: [{ points: awayPoints }] }] },
  }],
  ...options,
});
const teams: { home: Team; away: Team } = {
  home: { id: 'home', name: 'Red', league: '11U', season: '2026', players: [] },
  away: { id: 'away', name: 'Blue', league: '11U', season: '2026', players: [] },
};

describe('Scoreboard finalization behavior', () => {
  it('prepares a final game without mutating its live source', () => {
    const live = fixture();
    const final = prepareFinalizedMatch(live);
    expect(final).toMatchObject({ id: live.id, isComplete: true, status: 'FINAL', innings: live.innings });
    expect(live).toMatchObject({ isComplete: false, status: 'IN_PROGRESS' });
  });

  it('preserves distinct tie behavior for Exit and finish prompts', () => {
    const tied = fixture(2, 2);
    expect(getFinalizationDecision(tied, 'exit')).toBe('confirm-tie');
    expect(getFinalizationDecision(tied, 'finish')).toBe('start-extras');
    expect(getFinalizationDecision(tied, 'exit', true)).toBe('finalize');
    expect(getFinalizationDecision(fixture(), 'exit')).toBe('finalize');
    expect(getFinalizationDecision(fixture(), 'finish')).toBe('finalize');
    const withExtras = fixture(2, 2, {
      tieBreaker: [{ roundNumber: 1, pitchLimit: 5, homePlayerId: 'a', awayPlayerId: 'b', homeScores: [0], awayScores: [0] }]
    });
    expect(getFinalizationDecision(withExtras, 'exit')).toBe('finalize');
    expect(getFinalizationDecision(withExtras, 'finish')).toBe('start-extras');
  });

  it('retains the existing official/practice and Exit/finish messages', () => {
    expect(getFinalizationMessage(fixture(), teams, 'exit')).toBe(
      'Match Finalized! Final Score: Red 3 - Blue 2. Official stats and standings recorded.'
    );
    expect(getFinalizationMessage(fixture(), teams, 'finish')).toBe(
      'Match Finalized! Final Score: Red 3 - Blue 2. Standings and stats updated.'
    );
    expect(getFinalizationMessage(fixture(3, 2, { isPractice: true }), teams, 'exit')).toBe(
      'Practice Match Completed! Final Score: Red 3 - Blue 2. Stored on schedule.'
    );
  });

  it('creates 5, then 3, then 1-pitch extras without changing earlier rounds', () => {
    const original = fixture(2, 2);
    const limits: number[] = [];
    let current = original;
    for (let i = 0; i < 4; i++) {
      const next: TieBreakerRound = createNextTieBreakerRound(current.tieBreaker, 'a', 'b');
      limits.push(next.pitchLimit);
      expect(next.roundNumber).toBe(i + 1);
      expect(next.homeScores).toEqual(Array(next.pitchLimit).fill(null));
      expect(next.awayScores).toEqual(Array(next.pitchLimit).fill(null));
      current = appendTieBreakerRound(current, next);
      expect(current.status).toBe('IN_PROGRESS');
      expect(current.isComplete).toBe(false);
    }
    expect(limits).toEqual([5, 3, 1, 1]);
    expect(original.tieBreaker).toBeUndefined();
    expect(current.tieBreaker).toHaveLength(4);
  });

  it('counts extra-inning scores when resolving a tie', () => {
    const withExtras = fixture(2, 2, {
      tieBreaker: [{ roundNumber: 1, pitchLimit: 5, homePlayerId: 'a', awayPlayerId: 'b', homeScores: [3], awayScores: [1] }]
    });
    expect(getFinalizationDecision(withExtras, 'finish')).toBe('finalize');
  });
});
