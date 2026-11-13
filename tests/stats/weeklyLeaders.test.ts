import { describe, expect, it } from 'vitest';
import type { Inning, Match, Team } from '../../types';
import { calculateWeeklyLeaders } from '../../utils/weeklyLeaders';

const makeTeam = (id: string, players: string[], subs: string[] = []): Team => ({
  id, name: id, league: '11U', season: '2026',
  players: players.map(p => ({ id: p, name: p })),
  subs: subs.map(p => ({ id: p, name: p })),
});
const teams = [
  makeTeam('Tigers', ['p1', 'p2']),
  makeTeam('Bears', ['p3', 'p4', 'p5'], ['sub6']),
];
const inning = (home: Array<[string, Array<number | null>]>, away: Array<[string, Array<number | null>]>): Inning => ({
  number: 1,
  home: {
    teamId: 'Tigers',
    playerScores: home.map(([playerId, points]) => ({ playerId, pitches: points.map(p => ({ points: p })) })),
  },
  away: {
    teamId: 'Bears',
    playerScores: away.map(([playerId, points]) => ({ playerId, pitches: points.map(p => ({ points: p })) })),
  },
});
const game = (id: string, innings: Inning[], overrides: Partial<Match> = {}): Match => ({
  id, league: '11U', season: '2026', homeTeamId: 'Tigers',
  awayTeamId: 'Bears', date: '2026-11-11', status: 'FINAL',
  isComplete: true, is_practice: false, innings, ...overrides,
});

describe('Weekly leaderboard extraction', () => {
  it('uses only the first ten personal pitches in 2-player ghost mode', () => {
    const m = game('ghost', [inning([
      ['p1', [...Array(10).fill(4), ...Array(5).fill(2)]],
      ['p2', [...Array(10).fill(1), ...Array(5).fill(2)]],
    ], [
      ['p3', [3, 2]], ['p4', [1]], ['sub6', [4]],
    ])], {
      tieBreaker: [{
        roundNumber: 1, pitchLimit: 5, homePlayerId: 'p1', awayPlayerId: 'sub6',
        homeScores: [3, null], awayScores: [2, null],
      }],
    });

    const result = calculateWeeklyLeaders([m], teams);
    expect(result.topTotals[0]).toEqual({ name: 'p1', team: 'Tigers', score: 43 });
    expect(result.topInnings[0]).toEqual({ name: 'p1', team: 'Tigers', score: 40 });
    expect(result.topTotals.find(s => s.name === 'p2')?.score).toBe(10);
    expect(result.topTotals.find(s => s.name === 'sub6')?.score).toBe(6);
  });

  it('excludes forfeiting players as well as unfinished and practice matches', () => {
    const forfeit = game('forfeit', [inning([['p1', [4]]], [['p3', [2]]])], {
      isForfeit: true, is_forfeit: true, forfeitingTeamId: 'Tigers',
    });
    const practice = game('practice', [inning([['p1', [4, 4, 4]]], [['p3', [1]]])], {
      isPractice: true, is_practice: true,
    });
    const unfinished = game('pending', [inning([['p1', [4, 4]]], [['p3', [0]]])], {
      isComplete: false, status: 'IN_PROGRESS',
    });
    const result = calculateWeeklyLeaders([forfeit, practice, unfinished], teams);
    expect(result.topTotals).toEqual([{ name: 'p3', team: 'Bears', score: 2 }]);
    expect(result.topInnings).toEqual([{ name: 'p3', team: 'Bears', score: 2 }]);
  });

  it('retains each player only once using their best game and best inning', () => {
    const first = game('a', [inning([['p1', [2, 4]]], [['p3', [1]]])]);
    const second = game('b', [inning([['p1', [3, 4]]], [['p3', [0]]])]);
    const result = calculateWeeklyLeaders([first, second], teams);
    expect(result.topTotals.filter(x => x.name === 'p1')).toEqual([{ name: 'p1', team: 'Tigers', score: 7 }]);
    expect(result.topInnings.filter(x => x.name === 'p1')).toEqual([{ name: 'p1', team: 'Tigers', score: 7 }]);
    expect(calculateWeeklyLeaders([], teams)).toEqual({ topTotals: [], topInnings: [] });
  });
});
