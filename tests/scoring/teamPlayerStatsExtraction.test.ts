import { describe, expect, it } from 'vitest';
import type { Match, Team } from '../../types';
import { aggregateTeamPlayerStats } from '../../utils/teamPlayerStats';

const home: Team = {
  id: 'home', name: 'Home', league: '11U', season: '2026',
  players: [{ id: 'h1', name: 'Ava', lastName: 'Parker' }],
  subs: [{ id: 'hs', name: 'Ben', lastName: 'Stone' }],
};
const away: Team = {
  id: 'away', name: 'Away', league: '11U', season: '2026',
  players: [{ id: 'a1', name: 'Casey', lastName: 'Lee' }],
};
const pitch = (points: number | null) => ({ points });
const match = (id: string, homePoints: number, awayPoints: number, extras: Partial<Match> = {}): Match => ({
  id, league: '11U', season: '2026', date: '2026-11-11',
  homeTeamId: home.id, awayTeamId: away.id,
  isComplete: true, is_practice: false, status: 'FINAL',
  innings: [{
    number: 1,
    home: { teamId: home.id, playerScores: [
      { playerId: 'h1', pitches: [pitch(homePoints)] },
      { playerId: 'hs', pitches: [pitch(2)] },
    ] },
    away: { teamId: away.id, playerScores: [
      { playerId: 'a1', pitches: [pitch(awayPoints)] },
    ] },
  }],
  ...extras,
});

describe('Team player season stats extraction', () => {
  it('adds official games and substitute stats without mutating source data', () => {
    const matches = [match('1', 4, 3), match('2', 1, 2)];
    const snapshot = JSON.stringify(matches);
    const stats = aggregateTeamPlayerStats(home, matches, [home, away]);
    expect(stats.find(p => p.playerId === 'h1')).toMatchObject({
      totalPoints: 5, hits4: 1, hits1: 1, pitchesSeen: 2,
    });
    expect(stats.find(p => p.playerId === 'hs')).toMatchObject({
      totalPoints: 4, hits2: 2, pitchesSeen: 2,
    });
    expect(stats.some(p => p.playerId === 'a1')).toBe(false);
    expect(JSON.stringify(matches)).toBe(snapshot);
  });

  it('ignores incomplete and practice games', () => {
    const matches = [
      match('active', 4, 4, { isComplete: false, status: 'IN_PROGRESS' }),
      match('practice', 4, 4, { isPractice: true, is_practice: true }),
    ];
    expect(aggregateTeamPlayerStats(home, matches, [home, away])).toEqual([]);
  });

  it('excludes forfeiting team stats but retains compliant opponent stats', () => {
    const forfeited = match('forfeit', 4, 3, {
      isForfeit: true, is_forfeit: true, forfeitingTeamId: home.id,
    });
    expect(aggregateTeamPlayerStats(home, [forfeited], [home, away])).toEqual([]);
    const awayStats = aggregateTeamPlayerStats(away, [forfeited], [home, away]);
    expect(awayStats.find(p => p.playerId === 'a1')?.totalPoints).toBe(3);
  });

  it('includes tie-breaker points and excludes ghost identities', () => {
    const tied = match('tie', 2, 2, {
      tieBreaker: [{
        roundNumber: 1, pitchLimit: 3,
        homePlayerId: 'h1', awayPlayerId: 'a1',
        homeScores: [4, null, 1], awayScores: [3, 0, 2],
      }],
    });
    const stats = aggregateTeamPlayerStats(home, [tied], [home, away]);
    expect(stats.find(p => p.playerId === 'h1')).toMatchObject({
      totalPoints: 7, pitchesSeen: 3,
    });
    expect(stats.every(p => !p.playerId.startsWith('ghost-'))).toBe(true);
  });

  it('skips a game when the opponent roster is unavailable', () => {
    expect(aggregateTeamPlayerStats(home, [match('missing', 4, 3)], [home])).toEqual([]);
  });
});
