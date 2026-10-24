import { describe, it, expect } from 'vitest';
import { calculateTeamGameTotal, calculateMatchStats } from '../../services/storageService';
import { Match, Team, TieBreakerRound } from '../../types';

describe('Tie Breaker Mechanics & Progression', () => {
  const homeTeam: Team = {
    id: 't-home',
    name: 'Home Hawks',
    league: 'Varsity',
    season: '2026',
    players: [
      { id: 'h1', name: 'ShooterHome' },
      { id: 'h2', name: 'OtherHome' }
    ]
  };

  const awayTeam: Team = {
    id: 't-away',
    name: 'Away Aces',
    league: 'Varsity',
    season: '2026',
    players: [
      { id: 'a1', name: 'ShooterAway' },
      { id: 'a2', name: 'OtherAway' }
    ]
  };

  it('incorporates Round 1 (5 pitches) scores into team game totals', () => {
    const round1: TieBreakerRound = {
      roundNumber: 1,
      pitchLimit: 5,
      homePlayerId: 'h1',
      awayPlayerId: 'a1',
      homeScores: [4, 4, 3, 2, 1], // 14 pts
      awayScores: [3, 3, 3, 2, 2]  // 13 pts
    };

    const match: Match = {
      id: 'm-tb-1',
      league: 'Varsity',
      season: '2026',
      homeTeamId: 't-home',
      awayTeamId: 't-away',
      date: new Date().toISOString(),
      isComplete: true,
      innings: [
        {
          number: 1,
          home: { teamId: 'home', playerScores: [{ playerId: 'h1', pitches: [{ points: 10 }] }] },
          away: { teamId: 'away', playerScores: [{ playerId: 'a1', pitches: [{ points: 10 }] }] }
        }
      ],
      tieBreaker: [round1]
    };

    // Home: 10 (regulation) + 14 (tiebreaker) = 24
    expect(calculateTeamGameTotal('home', match)).toBe(24);
    // Away: 10 (regulation) + 13 (tiebreaker) = 23
    expect(calculateTeamGameTotal('away', match)).toBe(23);
  });

  it('advances pitch limit down from 5 to 3 in Round 2, and 1 in Round 3', () => {
    // Helper to determine next limit based on previous round limit (matching Scoreboard.tsx logic)
    const getNextLimit = (lastLimit?: number) => {
      if (!lastLimit) return 5;
      if (lastLimit === 5) return 3;
      return 1;
    };

    expect(getNextLimit(undefined)).toBe(5); // Round 1
    expect(getNextLimit(5)).toBe(3);         // Round 2
    expect(getNextLimit(3)).toBe(1);         // Round 3 (Sudden death)
    expect(getNextLimit(1)).toBe(1);         // Round 4+ (Remains sudden death)
  });

  it('attributes tiebreaker hits and points to the nominated shooters in match stats', () => {
    const round1: TieBreakerRound = {
      roundNumber: 1,
      pitchLimit: 5,
      homePlayerId: 'h1',
      awayPlayerId: 'a1',
      homeScores: [4, 3, 2, 1, 0],
      awayScores: [2, 2, 2, 2, 2]
    };

    const match: Match = {
      id: 'm-tb-stats',
      league: 'Varsity',
      season: '2026',
      homeTeamId: 't-home',
      awayTeamId: 't-away',
      date: new Date().toISOString(),
      isComplete: true,
      innings: [
        {
          number: 1,
          home: {
            teamId: 'home',
            playerScores: [{ playerId: 'h1', pitches: [{ points: 4 }] }, { playerId: 'h2', pitches: [{ points: 0 }] }]
          },
          away: {
            teamId: 'away',
            playerScores: [{ playerId: 'a1', pitches: [{ points: 2 }] }, { playerId: 'a2', pitches: [{ points: 0 }] }]
          }
        }
      ],
      tieBreaker: [round1]
    };

    const stats = calculateMatchStats(match, homeTeam, awayTeam);

    const shooterHome = stats.find(s => s.playerId === 'h1');
    expect(shooterHome).toBeDefined();
    // Regulation 1 pitch (points: 4) + Tiebreaker 5 pitches (4+3+2+1+0 = 10 pts)
    expect(shooterHome?.pitchesSeen).toBe(6);
    expect(shooterHome?.totalPoints).toBe(14);
    expect(shooterHome?.hits4).toBe(2); // 1 from reg + 1 from tb
    expect(shooterHome?.hits3).toBe(1);
    expect(shooterHome?.hits2).toBe(1);
    expect(shooterHome?.hits1).toBe(1);

    const shooterAway = stats.find(s => s.playerId === 'a1');
    expect(shooterAway).toBeDefined();
    // Regulation 1 pitch (points: 2) + Tiebreaker 5 pitches (5 * 2 = 10 pts)
    expect(shooterAway?.pitchesSeen).toBe(6);
    expect(shooterAway?.totalPoints).toBe(12);
    expect(shooterAway?.hits2).toBe(6); // 1 reg + 5 tb
  });
});
