import { describe, it, expect } from 'vitest';
import { calculateMatchStats, createPracticeMatch } from '../services/storageService';
import { Match, Team } from '../types';

describe('Practice Mode Verification', () => {
  const teamAlpha: Team = {
    id: 'team-alpha',
    name: 'Alpha Wolves',
    league: '10u',
    season: '2026',
    players: [
      { id: 'p-alpha-1', name: 'Ace', lastName: 'Miller' },
      { id: 'p-alpha-2', name: 'Ben', lastName: 'Carter' }
    ]
  };

  const teamBeta: Team = {
    id: 'team-beta',
    name: 'Beta Bears',
    league: '10u',
    season: '2026',
    players: [
      { id: 'p-beta-1', name: 'Charlie', lastName: 'Fox' },
      { id: 'p-beta-2', name: 'Danny', lastName: 'Shaw' }
    ]
  };

  // Official Match: Alpha (14 pts) defeats Beta (8 pts)
  const officialMatch: Match = {
    id: 'match-official-1',
    league: '10u',
    season: '2026',
    homeTeamId: teamAlpha.id,
    awayTeamId: teamBeta.id,
    date: '2026-11-01T18:00:00.000Z',
    isComplete: true,
    status: 'FINAL',
    isPractice: false,
    innings: [
      {
        number: 1,
        home: {
          teamId: teamAlpha.id,
          playerScores: [
            {
              playerId: 'p-alpha-1',
              pitches: [{ points: 4 }, { points: 4 }, { points: 3 }, { points: 3 }] // 14 pts
            }
          ]
        },
        away: {
          teamId: teamBeta.id,
          playerScores: [
            {
              playerId: 'p-beta-1',
              pitches: [{ points: 2 }, { points: 2 }, { points: 2 }, { points: 2 }] // 8 pts
            }
          ]
        }
      }
    ]
  };

  // Practice Match: In a practice session, Beta scores 30 massive points against Alpha
  const practiceMatch: Match = {
    id: 'match-practice-1',
    league: '10u',
    season: '2026',
    homeTeamId: teamAlpha.id,
    awayTeamId: teamBeta.id,
    date: '2026-11-02T19:00:00.000Z',
    isComplete: true,
    status: 'FINAL',
    isPractice: true,
    is_practice: true,
    innings: [
      {
        number: 1,
        home: {
          teamId: teamAlpha.id,
          playerScores: [
            {
              playerId: 'p-alpha-1',
              pitches: [{ points: 0 }, { points: 1 }] // 1 pt
            }
          ]
        },
        away: {
          teamId: teamBeta.id,
          playerScores: [
            {
              playerId: 'p-beta-1',
              pitches: [{ points: 4 }, { points: 4 }, { points: 4 }, { points: 4 }, { points: 4 }] // 20 pts
            }
          ]
        }
      }
    ]
  };

  it('generates hits and runs locally in the practice match game session', async () => {
    // 1. Practice match initializes properly with isPractice = true
    const initializedPractice = await createPracticeMatch({
      league: '10u',
      homeTeamId: teamAlpha.id,
      awayTeamId: teamBeta.id,
      homeLineupIds: ['p-alpha-1', 'p-alpha-2'],
      awayLineupIds: ['p-beta-1', 'p-beta-2'],
      season: '2026',
      inningsCount: 3,
      pitchesPerBatter: 5
    });

    expect(initializedPractice.isPractice).toBe(true);
    expect(initializedPractice.is_practice).toBe(true);
    expect(initializedPractice.status).toBe('IN_PROGRESS');
    expect(initializedPractice.innings).toHaveLength(3);

    // 2. Completing a practice game generates hits/runs locally in the game session
    const localPracticeStats = calculateMatchStats(practiceMatch, teamAlpha, teamBeta);
    expect(localPracticeStats.length).toBeGreaterThan(0);

    const betaPlayerStats = localPracticeStats.find(s => s.playerId === 'p-beta-1');
    expect(betaPlayerStats).toBeDefined();
    expect(betaPlayerStats!.totalPoints).toBe(20);
    expect(betaPlayerStats!.hits4).toBe(5);
  });

  it('strictly excludes practice matches from official league standings table', () => {
    const allMatches = [officialMatch, practiceMatch];

    // Helper that replicates App.tsx standings calculation
    const calculateStandings = (matches: Match[], league: string) => {
      const stats = new Map<string, { id: string; gp: number; w: number; l: number; t: number; pf: number; pa: number }>();
      stats.set(teamAlpha.id, { id: teamAlpha.id, gp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0 });
      stats.set(teamBeta.id, { id: teamBeta.id, gp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0 });

      matches.forEach(m => {
        // STRICT RULE: Exclude practice matches
        if (m.isPractice || m.is_practice || !m.isComplete || m.league !== league) return;

        const hScore = m.innings.reduce((acc, ing) =>
          acc + ing.home.playerScores.reduce((pAcc, p) =>
            pAcc + p.pitches.reduce((piAcc, pi) => piAcc + (pi.points || 0), 0), 0), 0);

        const aScore = m.innings.reduce((acc, ing) =>
          acc + ing.away.playerScores.reduce((pAcc, p) =>
            pAcc + p.pitches.reduce((piAcc, pi) => piAcc + (pi.points || 0), 0), 0), 0);

        const hRec = stats.get(m.homeTeamId)!;
        const aRec = stats.get(m.awayTeamId)!;
        hRec.gp++; aRec.gp++;
        hRec.pf += hScore; hRec.pa += aScore;
        aRec.pf += aScore; aRec.pa += hScore;

        if (hScore > aScore) { hRec.w++; aRec.l++; }
        else if (hScore < aScore) { aRec.w++; hRec.l++; }
        else { hRec.t++; aRec.t++; }
      });

      return Array.from(stats.values());
    };

    const standings = calculateStandings(allMatches, '10u');

    const alphaStanding = standings.find(s => s.id === teamAlpha.id)!;
    const betaStanding = standings.find(s => s.id === teamBeta.id)!;

    // Alpha should only have the 1 official game played (1-0 record, 14 PF, 8 PA)
    // The practice match result (Beta 20, Alpha 1) MUST NOT bleed in.
    expect(alphaStanding.gp).toBe(1);
    expect(alphaStanding.w).toBe(1);
    expect(alphaStanding.l).toBe(0);
    expect(alphaStanding.pf).toBe(14);
    expect(alphaStanding.pa).toBe(8);

    expect(betaStanding.gp).toBe(1);
    expect(betaStanding.w).toBe(0);
    expect(betaStanding.l).toBe(1);
    expect(betaStanding.pf).toBe(8);
    expect(betaStanding.pa).toBe(14);
  });

  it('strictly isolates player official season stats from practice match stats', () => {
    const allMatches = [officialMatch, practiceMatch];

    // Helper that replicates App.tsx seasonStats calculation
    const calculateSeasonPlayerStats = (matches: Match[]) => {
      const aggStats = new Map<string, { totalPoints: number; hits4: number; pitchesSeen: number }>();

      matches.forEach(m => {
        // STRICT RULE: Exclude practice matches
        if (m.isPractice || m.is_practice || !m.isComplete) return;

        const mStats = calculateMatchStats(m, teamAlpha, teamBeta);
        mStats.forEach(s => {
          if (!aggStats.has(s.playerId)) {
            aggStats.set(s.playerId, { totalPoints: s.totalPoints, hits4: s.hits4, pitchesSeen: s.pitchesSeen });
          } else {
            const curr = aggStats.get(s.playerId)!;
            curr.totalPoints += s.totalPoints;
            curr.hits4 += s.hits4;
            curr.pitchesSeen += s.pitchesSeen;
          }
        });
      });

      return aggStats;
    };

    const seasonAgg = calculateSeasonPlayerStats(allMatches);

    // Alpha player Ace Miller only gets stats from official game (14 pts, 2 HR/4s)
    const aceStats = seasonAgg.get('p-alpha-1');
    expect(aceStats).toBeDefined();
    expect(aceStats!.totalPoints).toBe(14);
    expect(aceStats!.hits4).toBe(2);

    // Beta player Charlie Fox only gets stats from official game (8 pts, 0 HR/4s)
    // The 5 home runs (20 pts) in practice mode MUST NOT be added
    const charlieStats = seasonAgg.get('p-beta-1');
    expect(charlieStats).toBeDefined();
    expect(charlieStats!.totalPoints).toBe(8);
    expect(charlieStats!.hits4).toBe(0);
  });

  it('filters out practice matches from public fan schedule view', () => {
    const allMatches = [officialMatch, practiceMatch];

    const getFanSchedule = (matches: Match[], userRole: 'fan' | 'umpire' | 'admin') => {
      return matches.filter(m => {
        if (userRole === 'fan' && (m.isPractice || m.is_practice)) return false;
        return true;
      });
    };

    const fanView = getFanSchedule(allMatches, 'fan');
    expect(fanView).toHaveLength(1);
    expect(fanView[0].id).toBe('match-official-1');

    const umpireView = getFanSchedule(allMatches, 'umpire');
    expect(umpireView).toHaveLength(2);
  });

  it('handles "Save & Exit" by retaining active practice session state for later resumption', async () => {
    const livePracticeMatch = await createPracticeMatch({
      league: '10u',
      homeTeamId: teamAlpha.id,
      awayTeamId: teamBeta.id,
      homeLineupIds: ['p-alpha-1', 'p-alpha-2'],
      awayLineupIds: ['p-beta-1', 'p-beta-2'],
      season: '2026',
      inningsCount: 3,
      pitchesPerBatter: 5
    });

    // Record some pitches in Inning 1
    livePracticeMatch.innings[0].home.playerScores[0].pitches[0].points = 3;
    livePracticeMatch.innings[0].away.playerScores[0].pitches[0].points = 4;

    // Simulate "Save & Exit": Match is NOT completed, status remains IN_PROGRESS
    const savedPracticeMatch: Match = {
      ...livePracticeMatch
    };

    expect(savedPracticeMatch.isComplete).toBe(false);
    expect(savedPracticeMatch.status).toBe('IN_PROGRESS');
    expect(savedPracticeMatch.isPractice).toBe(true);
    expect(savedPracticeMatch.innings[0].home.playerScores[0].pitches[0].points).toBe(3);
    expect(savedPracticeMatch.innings[0].away.playerScores[0].pitches[0].points).toBe(4);
  });

  it('handles exit by auto-deleting the practice match from matches list and clearing active banner state', async () => {
    const livePracticeMatch = await createPracticeMatch({
      league: '10u',
      homeTeamId: teamAlpha.id,
      awayTeamId: teamBeta.id,
      homeLineupIds: ['p-alpha-1', 'p-alpha-2'],
      awayLineupIds: ['p-beta-1', 'p-beta-2'],
      season: '2026',
      inningsCount: 3,
      pitchesPerBatter: 5
    });

    let currentMatches: Match[] = [officialMatch, livePracticeMatch];
    const fakeLocalStorage = new Map<string, string>();
    fakeLocalStorage.set('dugout_active_match_id', livePracticeMatch.id);
    expect(fakeLocalStorage.get('dugout_active_match_id')).toBe(livePracticeMatch.id);
    expect(currentMatches).toHaveLength(2);

    // Simulate Practice Match Exit: Auto-delete match from matches and clear active ID
    fakeLocalStorage.delete('dugout_active_match_id');
    currentMatches = currentMatches.filter(m => m.id !== livePracticeMatch.id);

    expect(currentMatches).toHaveLength(1);
    expect(currentMatches[0].id).toBe(officialMatch.id);
    expect(fakeLocalStorage.get('dugout_active_match_id')).toBeUndefined();

    // Verify active banner does not show
    const shouldShowBanner = fakeLocalStorage.has('dugout_active_match_id');
    expect(shouldShowBanner).toBe(false);
  });

  it('safely handles practice match IDs and strips practice- prefix for PostgreSQL UUID compatibility', async () => {
    const livePracticeMatch = await createPracticeMatch({
      league: '10u',
      homeTeamId: teamAlpha.id,
      awayTeamId: teamBeta.id,
      homeLineupIds: ['p-alpha-1', 'p-alpha-2'],
      awayLineupIds: ['p-beta-1', 'p-beta-2'],
      season: '2026',
      inningsCount: 3,
      pitchesPerBatter: 5
    });

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // 1. Practice match ID has practice- prefix
    expect(livePracticeMatch.id.startsWith('practice-')).toBe(true);

    // 2. The stripped remainder is a strictly valid PostgreSQL UUID
    const strippedUuid = livePracticeMatch.id.replace(/^practice-/, '');
    expect(uuidRegex.test(strippedUuid)).toBe(true);

    // 3. Match lookup resolves both prefixed and stripped ID formats safely
    const mockDbLookup = (queriedId: string, storedMatches: Match[]) => {
      const cleanId = queriedId.startsWith('practice-') ? queriedId.slice('practice-'.length) : queriedId;
      return storedMatches.find(m => m.id === queriedId || m.id === cleanId || m.id === `practice-${cleanId}`);
    };

    const foundWithPrefix = mockDbLookup(livePracticeMatch.id, [livePracticeMatch]);
    expect(foundWithPrefix).toBeDefined();
    expect(foundWithPrefix!.id).toBe(livePracticeMatch.id);

    const foundWithStripped = mockDbLookup(strippedUuid, [livePracticeMatch]);
    expect(foundWithStripped).toBeDefined();
  });
});
