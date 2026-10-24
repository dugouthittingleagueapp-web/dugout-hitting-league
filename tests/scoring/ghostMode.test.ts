import { describe, it, expect } from 'vitest';
import { createEmptyInning, calculateMatchStats, calculateTeamGameTotal } from '../../services/storageService';
import { Match, Team, Inning } from '../../types';

describe('Ghost Mode (3v2 & 2v3 Asymmetric Scoring)', () => {
  it('allocates 15 pitches per player for a 2-player team facing a 3-player team', () => {
    const homePlayerIds = ['h1', 'h2', 'h3']; // 3 players
    const awayPlayerIds = ['a1', 'a2'];       // 2 players (Short-handed)

    const inning = createEmptyInning(1, homePlayerIds, awayPlayerIds);

    // Home team has 3 players, 10 pitches each = 30 pitches
    expect(inning.home.playerScores.length).toBe(3);
    inning.home.playerScores.forEach(ps => expect(ps.pitches.length).toBe(10));

    // Away team has 2 players, 15 pitches each = 30 pitches (Ghost Mode)
    expect(inning.away.playerScores.length).toBe(2);
    inning.away.playerScores.forEach(ps => expect(ps.pitches.length).toBe(15));
  });

  it('allocates 15 pitches to home team when home is 2 players and away is 3 players', () => {
    const homePlayerIds = ['h1', 'h2'];       // 2 players
    const awayPlayerIds = ['a1', 'a2', 'a3']; // 3 players

    const inning = createEmptyInning(1, homePlayerIds, awayPlayerIds);

    expect(inning.home.playerScores.length).toBe(2);
    inning.home.playerScores.forEach(ps => expect(ps.pitches.length).toBe(15));

    expect(inning.away.playerScores.length).toBe(3);
    inning.away.playerScores.forEach(ps => expect(ps.pitches.length).toBe(10));
  });

  it('attributes pitches 1-10 to individual player and pitches 11-15 to Ghost Player', () => {
    const homeTeam: Team = {
      id: 'team-home',
      name: 'Full Home Team',
      league: '12u',
      season: '2026',
      players: [
        { id: 'h1', name: 'Home1' },
        { id: 'h2', name: 'Home2' },
        { id: 'h3', name: 'Home3' }
      ]
    };

    const awayTeam: Team = {
      id: 'team-away',
      name: 'Short Away Team',
      league: '12u',
      season: '2026',
      players: [
        { id: 'a1', name: 'Away1' },
        { id: 'a2', name: 'Away2' }
      ]
    };

    // Away player 1 gets 10 4s (pitches 1-10) and 5 1s (pitches 11-15)
    const a1Pitches = [
      ...Array(10).fill({ points: 4 }), // 40 pts for Player a1
      ...Array(5).fill({ points: 1 })   // 5 pts for Ghost
    ];

    // Away player 2 gets 10 2s (pitches 1-10) and 5 3s (pitches 11-15)
    const a2Pitches = [
      ...Array(10).fill({ points: 2 }), // 20 pts for Player a2
      ...Array(5).fill({ points: 3 })   // 15 pts for Ghost
    ];

    const inning: Inning = {
      number: 1,
      home: {
        teamId: 'home',
        playerScores: [
          { playerId: 'h1', pitches: Array(10).fill({ points: 1 }) },
          { playerId: 'h2', pitches: Array(10).fill({ points: 1 }) },
          { playerId: 'h3', pitches: Array(10).fill({ points: 1 }) }
        ]
      },
      away: {
        teamId: 'away',
        playerScores: [
          { playerId: 'a1', pitches: a1Pitches },
          { playerId: 'a2', pitches: a2Pitches }
        ]
      }
    };

    const match: Match = {
      id: 'm-ghost',
      league: '12u',
      season: '2026',
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      date: new Date().toISOString(),
      isComplete: true,
      innings: [inning]
    };

    const stats = calculateMatchStats(match, homeTeam, awayTeam);

    // Verify Player a1 individual stats
    const a1Stat = stats.find(s => s.playerId === 'a1');
    expect(a1Stat).toBeDefined();
    expect(a1Stat?.pitchesSeen).toBe(10); // Only first 10 pitches count
    expect(a1Stat?.totalPoints).toBe(40); // 10 * 4 = 40
    expect(a1Stat?.hits4).toBe(10);
    expect(a1Stat?.hits1).toBe(0); // The 1s were in pitches 11-15 so they don't count for a1

    // Verify Player a2 individual stats
    const a2Stat = stats.find(s => s.playerId === 'a2');
    expect(a2Stat).toBeDefined();
    expect(a2Stat?.pitchesSeen).toBe(10);
    expect(a2Stat?.totalPoints).toBe(20); // 10 * 2 = 20
    expect(a2Stat?.hits2).toBe(10);
    expect(a2Stat?.hits3).toBe(0); // The 3s were in pitches 11-15

    // Verify Ghost is filtered out of public player stats return list
    const ghostInStats = stats.find(s => s.playerId.startsWith('ghost-'));
    expect(ghostInStats).toBeUndefined();

    // Verify Ghost points (5 + 15 = 20) are still fully included in the total team game score
    // Away team total = Player1 (40+5) + Player2 (20+15) = 45 + 35 = 80
    const awayGameTotal = calculateTeamGameTotal('away', match);
    expect(awayGameTotal).toBe(80);
  });

  it('keeps standard 10 pitches per player when both teams have 2 players (no ghost mode)', () => {
    const homePlayerIds = ['h1', 'h2'];
    const awayPlayerIds = ['a1', 'a2'];

    const inning = createEmptyInning(1, homePlayerIds, awayPlayerIds);

    expect(inning.home.playerScores.length).toBe(2);
    inning.home.playerScores.forEach(ps => expect(ps.pitches.length).toBe(10));

    expect(inning.away.playerScores.length).toBe(2);
    inning.away.playerScores.forEach(ps => expect(ps.pitches.length).toBe(10));
  });

  it('accurately attributes stats to rostered substitutes participating in match', () => {
    const homeTeam: Team = {
      id: 't-sub-home',
      name: 'Home With Subs',
      league: '10u',
      season: '2026',
      players: [
        { id: 'h1', name: 'Starter1' },
        { id: 'h2', name: 'Starter2' }
      ],
      subs: [
        { id: 'sub1', name: 'RosterSub' }
      ]
    };

    const awayTeam: Team = {
      id: 't-sub-away',
      name: 'Away Standard',
      league: '10u',
      season: '2026',
      players: [
        { id: 'a1', name: 'Away1' },
        { id: 'a2', name: 'Away2' },
        { id: 'a3', name: 'Away3' }
      ]
    };

    const match: Match = {
      id: 'm-sub',
      league: '10u',
      season: '2026',
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      date: new Date().toISOString(),
      isComplete: true,
      innings: [
        {
          number: 1,
          home: {
            teamId: 'home',
            playerScores: [
              { playerId: 'h1', pitches: [{ points: 4 }] },
              { playerId: 'h2', pitches: [{ points: 2 }] },
              { playerId: 'sub1', pitches: [{ points: 3 }, { points: 3 }] } // Sub playing
            ]
          },
          away: {
            teamId: 'away',
            playerScores: [
              { playerId: 'a1', pitches: [{ points: 1 }] },
              { playerId: 'a2', pitches: [{ points: 1 }] },
              { playerId: 'a3', pitches: [{ points: 1 }] }
            ]
          }
        }
      ]
    };

    const stats = calculateMatchStats(match, homeTeam, awayTeam);
    const subStat = stats.find(s => s.playerId === 'sub1');

    expect(subStat).toBeDefined();
    expect(subStat?.name).toBe('RosterSub');
    expect(subStat?.totalPoints).toBe(6);
    expect(subStat?.hits3).toBe(2);
    expect(subStat?.pitchesSeen).toBe(2);
  });
});
