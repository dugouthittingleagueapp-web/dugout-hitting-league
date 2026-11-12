import { describe, expect, it } from 'vitest';
import type { Match, Team } from '../../types';
import { calculateLeagueStandings } from '../../utils/leagueStandings';
import { calculateTeamInningTotal, calculateTeamGameTotal, getMatchScores } from '../../utils/scoreTotals';
import * as storage from '../../services/storageService';

const team = (id: string, league = '11U'): Team => ({
  id, name: id, league, season: '2026', players: [],
});

const game = (
  id: string,
  homeTeamId: string,
  awayTeamId: string,
  homePoints: number,
  awayPoints: number,
  overrides: Partial<Match> = {}
): Match => ({
  id, league: '11U', season: '2026', homeTeamId, awayTeamId,
  date: '2026-11-11', status: 'FINAL', isComplete: true, is_practice: false,
  innings: [{
    number: 1,
    home: { teamId: homeTeamId, playerScores: [{ playerId: 'h1', pitches: [{ points: homePoints }] }] },
    away: { teamId: awayTeamId, playerScores: [{ playerId: 'a1', pitches: [{ points: awayPoints }] }] },
  }],
  ...overrides,
});

describe('Shared scoring totals', () => {
  it('counts regular pitches, zero and null, and all tie-breaker rounds consistently', () => {
    const m = game('m1', 'Tigers', 'Bears', 4, 2, {
      tieBreaker: [
        { roundNumber: 1, pitchLimit: 5, homePlayerId: 'h1', awayPlayerId: 'a1',
          homeScores: [1, 0, null], awayScores: [4, null] },
        { roundNumber: 2, pitchLimit: 3, homePlayerId: 'h1', awayPlayerId: 'a1',
          homeScores: [3], awayScores: [2] },
      ],
    });
    expect(calculateTeamInningTotal('home', m.innings[0])).toBe(4);
    expect(calculateTeamInningTotal('away', m.innings[0])).toBe(2);
    expect(calculateTeamGameTotal('home', m)).toBe(8);
    expect(calculateTeamGameTotal('away', m)).toBe(8);
    expect(getMatchScores(m)).toEqual({ home: 8, away: 8 });
    expect(storage.calculateTeamGameTotal('home', m)).toBe(8);
    expect(storage.calculateTeamInningTotal('home', m.innings[0])).toBe(4);
  });

  it('handles an unstarted game and missing optional inning', () => {
    expect(calculateTeamGameTotal('home', null)).toBe(0);
    expect(calculateTeamInningTotal('away')).toBe(0);
    expect(getMatchScores(game('unstarted', 'Tigers', 'Bears', 0, 0, { innings: [] })))
      .toEqual({ home: 0, away: 0 });
  });
});

describe('Official league standings', () => {
  const roster = [team('Tigers'), team('Bears'), team('Sharks')];

  it('excludes practice, unfinished and other-league games and preserves tie standings', () => {
    const matches = [
      game('a', 'Tigers', 'Bears', 4, 2),
      game('b', 'Tigers', 'Bears', 1, 1, { league: ' 11u ' }),
      game('practice', 'Tigers', 'Bears', 4, 0, { isPractice: true, is_practice: true }),
      game('unfinished', 'Bears', 'Tigers', 4, 0, { isComplete: false, status: 'IN_PROGRESS' }),
      game('different', 'Bears', 'Tigers', 4, 0, { league: '12U' }),
    ];
    const result = calculateLeagueStandings(matches, roster, ' 11u ');
    expect(result.map(r => r.id)).toEqual(['Tigers', 'Bears', 'Sharks']);
    expect(result[0]).toMatchObject({ gp: 2, w: 1, l: 0, t: 1, pf: 5, pa: 3 });
    expect(result[1]).toMatchObject({ gp: 2, w: 0, l: 1, t: 1, pf: 3, pa: 5 });
    expect(result[2]).toMatchObject({ gp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0 });
    expect(calculateLeagueStandings(matches, roster, null)).toEqual([]);
  });

  it('applies forfeits as losses with zero counted points for the forfeiting team', () => {
    const forfeit = game('forfeit', 'Tigers', 'Bears', 4, 3, {
      isForfeit: true, is_forfeit: true, forfeitingTeamId: 'Tigers',
    });
    const result = calculateLeagueStandings([forfeit], roster, '11U');
    const tigers = result.find(x => x.id === 'Tigers');
    const bears = result.find(x => x.id === 'Bears');
    expect(tigers).toMatchObject({ gp: 1, w: 0, l: 1, t: 0, pf: 0, pa: 3 });
    expect(bears).toMatchObject({ gp: 1, w: 1, l: 0, t: 0, pf: 3, pa: 0 });
  });

  it('includes tie-breaker points when deciding game result and points for/against', () => {
    const m = game('tie-break', 'Tigers', 'Bears', 2, 2, {
      tieBreaker: [{
        roundNumber: 1, pitchLimit: 5, homePlayerId: 'h1', awayPlayerId: 'a1',
        homeScores: [3, null], awayScores: [1, 0],
      }],
    });
    const result = calculateLeagueStandings([m], roster, '11U');
    expect(result[0]).toMatchObject({ id: 'Tigers', gp: 1, w: 1, pf: 5, pa: 3 });
    expect(result[1]).toMatchObject({ id: 'Bears', gp: 1, l: 1, pf: 3, pa: 5 });
  });
});
