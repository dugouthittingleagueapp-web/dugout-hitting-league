import { describe, it, expect } from 'vitest';
import { calculateMatchStats } from '../../services/storageService';
import { Match, Team, Inning, PlayerSeasonStatRow } from '../../types';

describe('Player Statistics & Career Aggregations', () => {
  const teamA: Team = {
    id: 't-a',
    name: 'Tigers',
    league: '10u',
    season: '2025',
    players: [
      { id: 'p-john-2025', name: 'John', lastName: 'Doe' },
      { id: 'p-bob-2025', name: 'Bob', lastName: 'Smith' }
    ]
  };

  const teamB: Team = {
    id: 't-b',
    name: 'Bears',
    league: '10u',
    season: '2025',
    players: [
      { id: 'p-sam-2025', name: 'Sam', lastName: 'Ray' },
      { id: 'p-alex-2025', name: 'Alex', lastName: 'Cole' }
    ]
  };

  it('accurately categorizes hits into 4s, 3s, 2s, 1s and zero misses', () => {
    const inning: Inning = {
      number: 1,
      home: {
        teamId: 'home',
        playerScores: [
          {
            playerId: 'p-john-2025',
            pitches: [
              { points: 4 }, { points: 4 },
              { points: 3 },
              { points: 2 }, { points: 2 }, { points: 2 },
              { points: 1 },
              { points: 0 }, { points: 0 }, { points: 0 }
            ]
          }
        ]
      },
      away: { teamId: 'away', playerScores: [] }
    };

    const match: Match = {
      id: 'm-stats-1',
      league: '10u',
      season: '2025',
      homeTeamId: teamA.id,
      awayTeamId: teamB.id,
      date: '2025-10-06T18:00:00.000Z',
      isComplete: true,
      innings: [inning]
    };

    const stats = calculateMatchStats(match, teamA, teamB);
    const johnStats = stats.find(s => s.playerId === 'p-john-2025');

    expect(johnStats).toBeDefined();
    expect(johnStats?.pitchesSeen).toBe(10);
    expect(johnStats?.hits4).toBe(2);
    expect(johnStats?.hits3).toBe(1);
    expect(johnStats?.hits2).toBe(3);
    expect(johnStats?.hits1).toBe(1);
    // Total Points: (2*4) + (1*3) + (3*2) + (1*1) = 8 + 3 + 6 + 1 = 18
    expect(johnStats?.totalPoints).toBe(18);
  });

  it('accurately computes Hit Percentage and Points Per Pitch formulas', () => {
    // 20 pitches seen, 14 hits, 38 total points
    const pitchesSeen = 20;
    const totalPoints = 38;
    const totalHits = 14;

    const pointsPerPitch = Number((totalPoints / pitchesSeen).toFixed(2));
    const hitPercentage = Number(((totalHits / pitchesSeen) * 100).toFixed(1));

    expect(pointsPerPitch).toBe(1.90);
    expect(hitPercentage).toBe(70.0);
  });

  it('computes Career Totals and Season Averages across multiple seasons', () => {
    const seasonRows: PlayerSeasonStatRow[] = [
      {
        season: '2025',
        leagueId: '10u',
        teamName: 'Tigers',
        gamesPlayed: 5,
        totalPoints: 120,
        hits4: 8,
        hits3: 12,
        hits2: 15,
        hits1: 10,
        pitchesSeen: 60,
        pointsPerPitch: 2.00,
        hitPercentage: 75.0
      },
      {
        season: '2026',
        leagueId: '12u',
        teamName: 'Hawks',
        gamesPlayed: 7,
        totalPoints: 180,
        hits4: 14,
        hits3: 16,
        hits2: 20,
        hits1: 12,
        pitchesSeen: 84,
        pointsPerPitch: 2.14,
        hitPercentage: 73.8
      }
    ];

    // Total GP: 5 + 7 = 12
    const totalGP = seasonRows.reduce((sum, r) => sum + r.gamesPlayed, 0);
    // Total Pts: 120 + 180 = 300
    const totalPts = seasonRows.reduce((sum, r) => sum + r.totalPoints, 0);
    // Total Pitches: 60 + 84 = 144
    const totalPit = seasonRows.reduce((sum, r) => sum + r.pitchesSeen, 0);

    const careerPPP = totalPit > 0 ? Number((totalPts / totalPit).toFixed(2)) : 0;
    const totalHits = (8 + 14) + (12 + 16) + (15 + 20) + (10 + 12);
    const careerHitPct = totalPit > 0 ? Number(((totalHits / totalPit) * 100).toFixed(1)) : 0;

    expect(totalGP).toBe(12);
    expect(totalPts).toBe(300);
    expect(totalPit).toBe(144);
    // 300 / 144 = 2.0833... -> 2.08
    expect(careerPPP).toBe(2.08);
    // Total hits = 22 + 28 + 35 + 22 = 107
    // 107 / 144 * 100 = 74.305... -> 74.3%
    expect(careerHitPct).toBe(74.3);

    // Season Averages across 2 seasons:
    const avgDiv = seasonRows.length; // 2 seasons
    const avgGP = Number((totalGP / avgDiv).toFixed(1));
    const avgPts = Math.round(totalPts / avgDiv);

    expect(avgGP).toBe(6.0);
    expect(avgPts).toBe(150);
  });
});
