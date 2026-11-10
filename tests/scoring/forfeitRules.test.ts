import { describe, it, expect, beforeEach } from 'vitest';
import { detectForfeit, isForfeitMatch, getForfeitingTeamId } from '../../services/matchHelpers';
import * as storage from '../../services/storageService';
import { Match, Team, Player } from '../../types';

// Polyfill minimal browser environment if running in Node
let testStore: Record<string, string> = {};
if (typeof window === 'undefined') {
  (global as any).window = {
    localStorage: {
      getItem: (k: string) => testStore[k] || null,
      setItem: (k: string, v: string) => { testStore[k] = String(v); },
      removeItem: (k: string) => { delete testStore[k]; },
      clear: () => { testStore = {}; }
    }
  };
  (global as any).localStorage = (global as any).window.localStorage;
}

describe('Official League Forfeit and Asymmetrical Stats Rules', () => {
  const homeTeam: Team = {
    id: 'team-home',
    name: 'Home Sluggers',
    league: 'Minors',
    season: '2026',
    players: [
      { id: 'h1', name: 'Alice' },
      { id: 'h2', name: 'Bob' },
      { id: 'h3', name: 'Charlie' }
    ],
    subs: [
      { id: 'h-sub1', name: 'Sub Dave' },
      { id: 'h-sub2', name: 'Sub Erin' }
    ]
  };

  const awayTeam: Team = {
    id: 'team-away',
    name: 'Away Aces',
    league: 'Minors',
    season: '2026',
    players: [
      { id: 'a1', name: 'Xavier' },
      { id: 'a2', name: 'Yolanda' },
      { id: 'a3', name: 'Zack' }
    ],
    subs: [
      { id: 'a-sub1', name: 'Sub Quinn' },
      { id: 'a-sub2', name: 'Sub Ray' }
    ]
  };

  beforeEach(() => {
    testStore = {};
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
      localStorage.setItem('dugout_all_teams', JSON.stringify([homeTeam, awayTeam]));
      localStorage.setItem('teams', JSON.stringify([homeTeam, awayTeam]));
    }
  });

  describe('1. Roster Threshold Validation (detectForfeit)', () => {
    it('flags forfeit when home fields only 1 main roster player against away 3 main players', () => {
      // Home fields Alice (main) plus two registered substitutes.
      const homeLineup = ['h1', 'h-sub1', 'h-sub2'];
      const awayLineup = ['a1', 'a2', 'a3'];

      const result = detectForfeit(homeTeam, awayTeam, homeLineup, awayLineup);
      expect(result.isForfeit).toBe(true);
      expect(result.forfeitingTeamId).toBe('team-home');
      expect(result.winningTeamId).toBe('team-away');
      expect(result.forfeitReason).toContain('Home Sluggers');
      expect(result.forfeitReason).toContain('1 main roster member');
    });

    it('does not treat an unknown lineup player ID as a substitute or assign a forfeit', () => {
      const result = detectForfeit(homeTeam, awayTeam, ['h1', 'h-sub1', 'stale-james-id'], ['a1', 'a2', 'a3']);
      expect(result.isForfeit).toBe(false);
      expect(result.unknownHomeIds).toEqual(['stale-james-id']);
      expect(result.unknownAwayIds).toEqual([]);
    });

    it('flags forfeit when away fields only 1 main player against home 2 main players', () => {
      const homeLineup = ['h1', 'h2'];
      const awayLineup = ['a1', 'a-sub1', 'a-sub2'];

      const result = detectForfeit(homeTeam, awayTeam, homeLineup, awayLineup);
      expect(result.isForfeit).toBe(true);
      expect(result.forfeitingTeamId).toBe('team-away');
      expect(result.winningTeamId).toBe('team-home');
      expect(result.forfeitReason).toContain('Away Aces');
    });

    it('does NOT flag forfeit when both teams field 2 or more main members', () => {
      const homeLineup = ['h1', 'h2', 'h-sub1'];
      const awayLineup = ['a1', 'a2', 'a3'];

      const result = detectForfeit(homeTeam, awayTeam, homeLineup, awayLineup);
      expect(result.isForfeit).toBe(false);
      expect(result.forfeitingTeamId).toBeNull();
      expect(result.winningTeamId).toBeNull();
    });

    it('does NOT flag forfeit when both teams field 3 main members', () => {
      const homeLineup = ['h1', 'h2', 'h3'];
      const awayLineup = ['a1', 'a2', 'a3'];

      const result = detectForfeit(homeTeam, awayTeam, homeLineup, awayLineup);
      expect(result.isForfeit).toBe(false);
    });

    it('does NOT flag forfeit when both teams field only 1 main player (both short)', () => {
      const homeLineup = ['h1', 'h-sub1'];
      const awayLineup = ['a1', 'a-sub1'];

      const result = detectForfeit(homeTeam, awayTeam, homeLineup, awayLineup);
      expect(result.isForfeit).toBe(false);
    });
  });

  describe('2. Helper Extraction and Normalization', () => {
    it('correctly identifies forfeit status with isForfeitMatch and getForfeitingTeamId', () => {
      const matchWithSnakeCase: Match = {
        id: 'm1',
        league: 'Minors',
        season: '2026',
        isComplete: true,
        is_practice: false,
        isPractice: false,
        homeTeamId: 'team-home',
        awayTeamId: 'team-away',
        date: '2026-04-01',
        is_forfeit: true,
        forfeiting_team_id: 'team-home',
        winning_team_id: 'team-away',
        innings: []
      };

      expect(isForfeitMatch(matchWithSnakeCase)).toBe(true);
      expect(getForfeitingTeamId(matchWithSnakeCase)).toBe('team-home');

      const matchWithCamelCase: Match = {
        id: 'm2',
        league: 'Minors',
        season: '2026',
        isComplete: true,
        is_practice: false,
        isPractice: false,
        homeTeamId: 'team-home',
        awayTeamId: 'team-away',
        date: '2026-04-01',
        isForfeit: true,
        forfeitingTeamId: 'team-away',
        winningTeamId: 'team-home',
        innings: []
      };

      expect(isForfeitMatch(matchWithCamelCase)).toBe(true);
      expect(getForfeitingTeamId(matchWithCamelCase)).toBe('team-away');
    });
  });

  describe('3. Asymmetrical Stats Exclusion Logic', () => {
    it('excludes forfeiting team player stats while retaining compliant team stats', () => {
      // Build a completed forfeit match: Home forfeited to Away
      const forfeitMatch: Match = {
        id: 'forfeit-test-match',
        league: 'Minors',
        season: '2026',
        is_practice: false,
        isPractice: false,
        homeTeamId: 'team-home',
        awayTeamId: 'team-away',
        date: '2026-04-01',
        isComplete: true,
        is_forfeit: true,
        isForfeit: true,
        forfeiting_team_id: 'team-home',
        forfeitingTeamId: 'team-home',
        winning_team_id: 'team-away',
        winningTeamId: 'team-away',
        innings: [
          {
            number: 1,
            home: {
              teamId: 'team-home',
              playerScores: [
                {
                  playerId: 'h1',
                  pitches: [{ points: 4 }, { points: 3 }, { points: 2 }] // 9 points
                }
              ]
            },
            away: {
              teamId: 'team-away',
              playerScores: [
                {
                  playerId: 'a1',
                  pitches: [{ points: 4 }, { points: 4 }, { points: 4 }] // 12 points
                }
              ]
            }
          }
        ]
      };

      // Raw match stats contains both teams
      const rawMatchStats = storage.calculateMatchStats(forfeitMatch, homeTeam, awayTeam);
      const aliceRaw = rawMatchStats.find(s => s.playerId === 'h1');
      const xavierRaw = rawMatchStats.find(s => s.playerId === 'a1');
      expect(aliceRaw?.totalPoints).toBe(9);
      expect(xavierRaw?.totalPoints).toBe(12);

      // In official aggregations (Standings / Leaderboards / Season Stats),
      // the forfeiting team is strictly filtered out
      const isForfeit = isForfeitMatch(forfeitMatch);
      const forfeitingId = getForfeitingTeamId(forfeitMatch);
      expect(isForfeit).toBe(true);
      expect(forfeitingId).toBe('team-home');

      const officialAggregatedStats = rawMatchStats.filter(s => {
        if (isForfeit && forfeitingId) {
          const forfeitingTeam = forfeitingId === homeTeam.id ? homeTeam : awayTeam;
          const isForfeitingPlayer = [...(forfeitingTeam.players || []), ...(forfeitingTeam.subs || [])].some(
            p => p.id === s.playerId
          );
          if (isForfeitingPlayer) return false;
        }
        return true;
      });

      // Compliant player Xavier is retained
      expect(officialAggregatedStats.some(s => s.playerId === 'a1')).toBe(true);
      const xavierOfficial = officialAggregatedStats.find(s => s.playerId === 'a1');
      expect(xavierOfficial?.totalPoints).toBe(12);
      expect(xavierOfficial?.hits4).toBe(3);

      // Forfeiting player Alice is completely excluded
      expect(officialAggregatedStats.some(s => s.playerId === 'h1')).toBe(false);
    });

    it('asymmetrically calculates standings for forfeit match (automatic win for compliant, loss for forfeiting)', () => {
      const forfeitMatch: Match = {
        id: 'forfeit-test-match-2',
        league: 'Minors',
        season: '2026',
        is_practice: false,
        isPractice: false,
        homeTeamId: 'team-home',
        awayTeamId: 'team-away',
        date: '2026-04-01',
        isComplete: true,
        is_forfeit: true,
        isForfeit: true,
        forfeiting_team_id: 'team-home',
        forfeitingTeamId: 'team-home',
        winning_team_id: 'team-away',
        winningTeamId: 'team-away',
        innings: [
          {
            number: 1,
            home: {
              teamId: 'team-home',
              playerScores: [
                {
                  playerId: 'h1',
                  pitches: [{ points: 4 }] // 4 points
                }
              ]
            },
            away: {
              teamId: 'team-away',
              playerScores: [
                {
                  playerId: 'a1',
                  pitches: [{ points: 4 }, { points: 3 }] // 7 points
                }
              ]
            }
          }
        ]
      };

      const stats = new Map<string, { id: string, gp: number, w: number, l: number, t: number, pf: number, pa: number }>();
      stats.set(homeTeam.id, { id: homeTeam.id, gp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0 });
      stats.set(awayTeam.id, { id: awayTeam.id, gp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0 });

      const isForfeit = isForfeitMatch(forfeitMatch);
      const forfeitingId = getForfeitingTeamId(forfeitMatch);

      const hScore = 4;
      const aScore = 7;

      if (isForfeit && forfeitingId) {
        const isHomeForfeiting = forfeitingId === forfeitMatch.homeTeamId;
        const homeRec = stats.get(forfeitMatch.homeTeamId);
        const awayRec = stats.get(forfeitMatch.awayTeamId);

        if (homeRec) {
          homeRec.gp++;
          if (isHomeForfeiting) {
            homeRec.l++;
            homeRec.pf += 0; // excluded
            homeRec.pa += aScore;
          } else {
            homeRec.w++;
            homeRec.pf += hScore;
            homeRec.pa += 0;
          }
        }

        if (awayRec) {
          awayRec.gp++;
          if (isHomeForfeiting) {
            awayRec.w++;
            awayRec.pf += aScore; // intact
            awayRec.pa += 0;
          } else {
            awayRec.l++;
            awayRec.pf += 0;
            awayRec.pa += hScore;
          }
        }
      }

      const homeFinal = stats.get(homeTeam.id)!;
      const awayFinal = stats.get(awayTeam.id)!;

      // Compliant Away team gets automatic Win and points intact
      expect(awayFinal.w).toBe(1);
      expect(awayFinal.l).toBe(0);
      expect(awayFinal.pf).toBe(7);

      // Forfeiting Home team gets automatic Loss and 0 points for
      expect(homeFinal.w).toBe(0);
      expect(homeFinal.l).toBe(1);
      expect(homeFinal.pf).toBe(0);
    });
  });
});
