import { describe, it, expect } from 'vitest';
import { createEmptyInning, calculateTeamInningTotal, calculateTeamGameTotal } from '../../services/storageService';
import { Inning, Match } from '../../types';

describe('Core Umpire Inning Scoring', () => {
  it('creates standard 3v3 inning with 10 pitches per player (30 pitches per team)', () => {
    const homePlayerIds = ['p1', 'p2', 'p3'];
    const awayPlayerIds = ['p4', 'p5', 'p6'];

    const inning = createEmptyInning(1, homePlayerIds, awayPlayerIds);

    expect(inning.number).toBe(1);
    expect(inning.home.playerScores.length).toBe(3);
    expect(inning.away.playerScores.length).toBe(3);

    // Each player has 10 pitches initialized to null
    inning.home.playerScores.forEach(ps => {
      expect(ps.pitches.length).toBe(10);
      ps.pitches.forEach(p => expect(p.points).toBeNull());
    });

    inning.away.playerScores.forEach(ps => {
      expect(ps.pitches.length).toBe(10);
      ps.pitches.forEach(p => expect(p.points).toBeNull());
    });
  });

  it('creates standard 2v2 inning with 10 pitches per player (20 pitches per team)', () => {
    const homePlayerIds = ['p1', 'p2'];
    const awayPlayerIds = ['p3', 'p4'];

    const inning = createEmptyInning(1, homePlayerIds, awayPlayerIds);

    expect(inning.home.playerScores.length).toBe(2);
    expect(inning.away.playerScores.length).toBe(2);

    inning.home.playerScores.forEach(ps => {
      expect(ps.pitches.length).toBe(10);
      ps.pitches.forEach(p => expect(p.points).toBeNull());
    });

    inning.away.playerScores.forEach(ps => {
      expect(ps.pitches.length).toBe(10);
      ps.pitches.forEach(p => expect(p.points).toBeNull());
    });
  });

  it('calculates team inning score accurately from individual player pitches', () => {
    const inning: Inning = {
      number: 1,
      home: {
        teamId: 'home',
        playerScores: [
          { playerId: 'p1', pitches: [{ points: 4 }, { points: 3 }, { points: 0 }, { points: 2 }] },
          { playerId: 'p2', pitches: [{ points: 1 }, { points: 1 }, { points: 3 }, { points: 4 }] }
        ]
      },
      away: {
        teamId: 'away',
        playerScores: [
          { playerId: 'p3', pitches: [{ points: 2 }, { points: 2 }, { points: 2 }, { points: null }] }
        ]
      }
    };

    // Home: (4+3+0+2) + (1+1+3+4) = 9 + 9 = 18
    expect(calculateTeamInningTotal('home', inning)).toBe(18);
    // Away: 2+2+2+0 = 6
    expect(calculateTeamInningTotal('away', inning)).toBe(6);
  });

  it('calculates full match team totals across multiple innings', () => {
    const mockMatch: Match = {
      id: 'm1',
      league: '12u',
      season: '2026',
      homeTeamId: 't-home',
      awayTeamId: 't-away',
      date: new Date().toISOString(),
      isComplete: false,
      is_practice: false,
      innings: [
        {
          number: 1,
          home: { teamId: 'home', playerScores: [{ playerId: 'p1', pitches: [{ points: 4 }, { points: 3 }] }] },
          away: { teamId: 'away', playerScores: [{ playerId: 'p2', pitches: [{ points: 2 }, { points: 2 }] }] }
        },
        {
          number: 2,
          home: { teamId: 'home', playerScores: [{ playerId: 'p1', pitches: [{ points: 1 }, { points: 2 }] }] },
          away: { teamId: 'away', playerScores: [{ playerId: 'p2', pitches: [{ points: 3 }, { points: 4 }] }] }
        }
      ]
    };

    // Home: (4+3) + (1+2) = 10
    expect(calculateTeamGameTotal('home', mockMatch)).toBe(10);
    // Away: (2+2) + (3+4) = 11
    expect(calculateTeamGameTotal('away', mockMatch)).toBe(11);
  });

  it('supports undoing a scored pitch by resetting the cell to null without affecting others', () => {
    const inning: Inning = {
      number: 1,
      home: {
        teamId: 'home',
        playerScores: [
          {
            playerId: 'p1',
            pitches: [{ points: 4 }, { points: 3 }, { points: 2 }, { points: null }]
          }
        ]
      },
      away: { teamId: 'away', playerScores: [] }
    };

    // Before undo: total points = 9
    expect(calculateTeamInningTotal('home', inning)).toBe(9);

    // Undo pitch 2 (0-indexed pitchIdx 2 was points: 2)
    const pitchToUndo = inning.home.playerScores[0].pitches[2];
    pitchToUndo.points = null;

    // After undo: total points = 4 + 3 = 7
    expect(calculateTeamInningTotal('home', inning)).toBe(7);
    expect(inning.home.playerScores[0].pitches[0].points).toBe(4);
    expect(inning.home.playerScores[0].pitches[1].points).toBe(3);
    expect(inning.home.playerScores[0].pitches[2].points).toBeNull();
  });

  it('correctly detects tie condition at regulation conclusion', () => {
    const completedRegulationMatch: Match = {
      id: 'm-tied',
      league: 'Varsity',
      season: '2026',
      homeTeamId: 't1',
      awayTeamId: 't2',
      date: new Date().toISOString(),
      isComplete: false,
      is_practice: false,
      innings: Array.from({ length: 6 }, (_, idx) => ({
        number: idx + 1,
        home: {
          teamId: 'home',
          playerScores: [{ playerId: 'p1', pitches: [{ points: 4 }, { points: 2 }] }] // 6 pts per inning * 6 = 36
        },
        away: {
          teamId: 'away',
          playerScores: [{ playerId: 'p2', pitches: [{ points: 3 }, { points: 3 }] }] // 6 pts per inning * 6 = 36
        }
      }))
    };

    const homeTotal = calculateTeamGameTotal('home', completedRegulationMatch);
    const awayTotal = calculateTeamGameTotal('away', completedRegulationMatch);

    expect(homeTotal).toBe(36);
    expect(awayTotal).toBe(36);
    expect(homeTotal === awayTotal).toBe(true);
  });
});
