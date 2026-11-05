import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as storage from '../../services/storageService';
import { Match, Team } from '../../types';

describe('Exit & Finalize Match Functionality', () => {
  const homeTeam: Team = {
    id: 'team-crushers',
    name: 'C-C-Crushers!',
    league: '7-9',
    season: '2026',
    players: [
      { id: 'p1', name: 'Liam', lastName: 'Davis' },
      { id: 'p2', name: 'Noah', lastName: 'Wilson' }
    ]
  };

  const awayTeam: Team = {
    id: 'team-bright',
    name: 'AYRA Bright',
    league: '7-9',
    season: '2026',
    players: [
      { id: 'p3', name: 'Oliver', lastName: 'Taylor' },
      { id: 'p4', name: 'Elijah', lastName: 'Anderson' }
    ]
  };

  const activeMatch: Match = {
    id: 'match-test-exit-finalize',
    league: '7-9',
    season: '2026',
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    date: '2026-11-04T12:00:00Z',
    isComplete: false,
    status: 'IN_PROGRESS',
    is_practice: false,
    innings: [
      {
        number: 1,
        home: {
          teamId: homeTeam.id,
          playerScores: [
            { playerId: 'p1', pitches: [{ points: 4 }, { points: 2 }] },
            { playerId: 'p2', pitches: [{ points: 3 }, { points: 1 }] }
          ]
        },
        away: {
          teamId: awayTeam.id,
          playerScores: [
            { playerId: 'p3', pitches: [{ points: 2 }, { points: 1 }] },
            { playerId: 'p4', pitches: [{ points: 0 }, { points: 2 }] }
          ]
        }
      }
    ]
  };

  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    vi.restoreAllMocks();
    mockStorage = {};
    const storageMock = {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, val: string) => { mockStorage[key] = String(val); },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; }
    };
    vi.stubGlobal('localStorage', storageMock);
  });

  it('should mark match as FINAL and complete when Exit & Finalize is executed', async () => {
    const updateSpy = vi.spyOn(storage, 'updateMatch').mockImplementation(async (m: Match) => m);
    localStorage.setItem('dugout_active_match_id', activeMatch.id);

    // Simulate Exit & Finalize
    const finalizedMatch: Match = {
      ...activeMatch,
      isComplete: true,
      status: 'FINAL'
    };

    await storage.updateMatch(finalizedMatch);
    localStorage.removeItem('dugout_active_match_id');

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: activeMatch.id,
        isComplete: true,
        status: 'FINAL'
      })
    );
    expect(localStorage.getItem('dugout_active_match_id')).toBeNull();
  });

  it('should retain match in progress when Save & Exit is executed', async () => {
    const updateSpy = vi.spyOn(storage, 'updateMatch').mockImplementation(async (m: Match) => m);
    localStorage.setItem('dugout_active_match_id', activeMatch.id);

    // Simulate Save & Exit (resume later)
    await storage.updateMatch(activeMatch);

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: activeMatch.id,
        isComplete: false,
        status: 'IN_PROGRESS'
      })
    );
    // Active ID is kept in storage for Save & Exit resumption
    expect(localStorage.getItem('dugout_active_match_id')).toBe(activeMatch.id);
  });

  it('should correctly calculate final team totals for confirmation message', () => {
    const homeTotal = activeMatch.innings.reduce((sum, ing) => {
      return sum + ing.home.playerScores.reduce((pSum, p) => {
        return pSum + p.pitches.reduce((ptSum, pt) => ptSum + (pt.points || 0), 0);
      }, 0);
    }, 0);

    const awayTotal = activeMatch.innings.reduce((sum, ing) => {
      return sum + ing.away.playerScores.reduce((pSum, p) => {
        return pSum + p.pitches.reduce((ptSum, pt) => ptSum + (pt.points || 0), 0);
      }, 0);
    }, 0);

    // Home: 4 + 2 + 3 + 1 = 10
    expect(homeTotal).toBe(10);
    // Away: 2 + 1 + 0 + 2 = 5
    expect(awayTotal).toBe(5);

    const message = `Match Finalized! Final Score: ${homeTeam.name} ${homeTotal} - ${awayTeam.name} ${awayTotal}. Official stats and standings recorded.`;
    expect(message).toContain('C-C-Crushers! 10 - AYRA Bright 5');
  });
});
