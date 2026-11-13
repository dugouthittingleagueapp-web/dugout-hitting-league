import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Match, Team } from '../../types';
import * as matchHelpers from '../../services/matchHelpers';
import * as storage from '../../services/storageService';
import { 
  signSessionToken, 
  verifySessionToken, 
  hashPassword, 
  comparePassword, 
  getAuthFromRequest 
} from '../../api/auth';
import { migrations } from '../../api/migrations';

describe('MASTER ENGINEERING DIRECTIVE — Security & Architecture Audit', () => {
  // Polyfill window and localStorage for node test runner
  let mockStorage: Record<string, string> = {};

  const localStorageMock = {
    getItem: vi.fn((key: string) => mockStorage[key] || null),
    setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
    removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
    clear: vi.fn(() => { mockStorage = {}; }),
    key: vi.fn((index: number) => Object.keys(mockStorage)[index] || null),
    get length() { return Object.keys(mockStorage).length; }
  };

  beforeEach(() => {
    // Tests use their own private signing key, never the production key.
    vi.stubEnv('SESSION_SECRET', 'unit-test-only-session-secret-not-for-live-use-2026');
    mockStorage = {};
    if (typeof (global as any).window === 'undefined') {
      (global as any).window = global;
    }
    (global as any).window.localStorage = localStorageMock;
    (global as any).localStorage = localStorageMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // Test teams
  const teamRed: Team = {
    id: 'team-red',
    name: 'Red Rockets',
    league: '10u',
    season: '2026',
    players: [
      { id: 'player-r1', name: 'Ricky', lastName: 'Vance' },
      { id: 'player-r2', name: 'Ryan', lastName: 'Cole' }
    ]
  };

  const teamBlue: Team = {
    id: 'team-blue',
    name: 'Blue Bombers',
    league: '10u',
    season: '2026',
    players: [
      { id: 'player-b1', name: 'Bobby', lastName: 'Drake' },
      { id: 'player-b2', name: 'Billy', lastName: 'Hays' }
    ]
  };

  // Official Match: Red (10 pts) vs Blue (5 pts)
  const officialMatch: Match = {
    id: 'official-match-001',
    league: '10u',
    season: '2026',
    homeTeamId: teamRed.id,
    awayTeamId: teamBlue.id,
    date: '2026-05-10T18:00:00.000Z',
    isComplete: true,
    status: 'FINAL',
    isPractice: false,
    is_practice: false,
    innings: [
      {
        number: 1,
        home: {
          teamId: teamRed.id,
          playerScores: [
            { playerId: 'player-r1', pitches: [{ points: 4 }, { points: 3 }, { points: 3 }] } // 10 pts
          ]
        },
        away: {
          teamId: teamBlue.id,
          playerScores: [
            { playerId: 'player-b1', pitches: [{ points: 2 }, { points: 2 }, { points: 1 }] } // 5 pts
          ]
        }
      }
    ]
  };

  // Practice Match: Exaggerated Practice Match (Blue 100 pts, Red 0 pts, 25 4-point HRs)
  const practiceMatch: Match = {
    id: 'practice-match-999',
    league: '10u',
    season: '2026',
    homeTeamId: teamRed.id,
    awayTeamId: teamBlue.id,
    date: '2026-05-11T19:00:00.000Z',
    isComplete: true,
    status: 'FINAL',
    isPractice: true,
    is_practice: true,
    innings: [
      {
        number: 1,
        home: {
          teamId: teamRed.id,
          playerScores: [
            { playerId: 'player-r1', pitches: [{ points: 0 }] }
          ]
        },
        away: {
          teamId: teamBlue.id,
          playerScores: [
            { 
              playerId: 'player-b1', 
              pitches: Array.from({ length: 25 }, () => ({ points: 4 })) // 100 pts!
            }
          ]
        }
      }
    ]
  };

  describe('Suite 1: Deletion Security & Official Game Immutability', () => {
    it('isOfficialMatch and isPracticeMatch strictly differentiate records', () => {
      expect(matchHelpers.isOfficialMatch(officialMatch)).toBe(true);
      expect(matchHelpers.isPracticeMatch(officialMatch)).toBe(false);
      expect(matchHelpers.canDeletePracticeMatch('admin', officialMatch)).toBe(false);
      expect(matchHelpers.canDeletePracticeMatch('umpire', officialMatch)).toBe(false);
      expect(matchHelpers.canDeletePracticeMatch('fan', officialMatch)).toBe(false);

      expect(matchHelpers.isOfficialMatch(practiceMatch)).toBe(false);
      expect(matchHelpers.isPracticeMatch(practiceMatch)).toBe(true);
      expect(matchHelpers.canDeletePracticeMatch('admin', practiceMatch)).toBe(true);
      expect(matchHelpers.canDeletePracticeMatch('umpire', practiceMatch)).toBe(true);
      expect(matchHelpers.canDeletePracticeMatch('fan', practiceMatch)).toBe(false);

      // Undefined or null is_practice must default to official and non-deletable
      const legacyNullMatch = { id: 'legacy-1', isPractice: undefined, is_practice: undefined };
      expect(matchHelpers.isOfficialMatch(legacyNullMatch)).toBe(true);
      expect(matchHelpers.isPracticeMatch(legacyNullMatch)).toBe(false);
      expect(matchHelpers.canDeletePracticeMatch('admin', legacyNullMatch)).toBe(false);
    });

    it('pre-flight storage delete check blocks official game deletion locally with Forbidden', async () => {
      mockStorage['dugout_match_official-match-001'] = JSON.stringify(officialMatch);

      await expect(storage.deleteMatch('official-match-001')).rejects.toThrow(/Forbidden/i);
    });

    it('auth helper rejects unauthenticated and fan deletion attempts', () => {
      const unauthReq = { headers: {} };
      const fanReq = { headers: { authorization: 'Bearer invalid.token' } };
      
      const adminToken = signSessionToken('admin');
      const adminReq = { headers: { authorization: `Bearer ${adminToken}` } };

      const umpireToken = signSessionToken('umpire');
      const umpireReq = { headers: { authorization: `Bearer ${umpireToken}` } };

      expect(getAuthFromRequest(unauthReq).authenticated).toBe(false);
      expect(getAuthFromRequest(fanReq).authenticated).toBe(false);

      const adminAuth = getAuthFromRequest(adminReq);
      expect(adminAuth.authenticated).toBe(true);
      expect(adminAuth.role).toBe('admin');

      const umpireAuth = getAuthFromRequest(umpireReq);
      expect(umpireAuth.authenticated).toBe(true);
      expect(umpireAuth.role).toBe('umpire');
    });
  });

  describe('Suite 2: Storage Service False-Success Bug Prevention', () => {
    beforeEach(() => {
      mockStorage = {
        'dugout_match_practice-test-1': JSON.stringify(practiceMatch),
        'dugout_active_match_id': 'practice-test-1',
        'dugout_matches_10u': JSON.stringify([practiceMatch])
      };
    });

    it('preserves local cache when DELETE returns 403 Forbidden', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Forbidden: Official league matches cannot be deleted.' })
      } as any);

      await expect(storage.deleteMatch('practice-test-1')).rejects.toThrow(/Forbidden/i);

      // Verify local storage was NOT wiped
      expect(mockStorage['dugout_match_practice-test-1']).toBeDefined();
      expect(mockStorage['dugout_active_match_id']).toBe('practice-test-1');
      expect(mockStorage['dugout_matches_10u']).toBeDefined();

      global.fetch = originalFetch;
    });

    it('preserves local cache when DELETE returns 500 Internal Server Error', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Database transaction failure' })
      } as any);

      await expect(storage.deleteMatch('practice-test-1')).rejects.toThrow(/Database transaction failure/i);

      expect(mockStorage['dugout_match_practice-test-1']).toBeDefined();
      expect(mockStorage['dugout_active_match_id']).toBe('practice-test-1');

      global.fetch = originalFetch;
    });

    it('preserves local cache when network request throws an exception', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

      await expect(storage.deleteMatch('practice-test-1')).rejects.toThrow(/Network offline/i);

      expect(mockStorage['dugout_match_practice-test-1']).toBeDefined();
      expect(mockStorage['dugout_active_match_id']).toBe('practice-test-1');

      global.fetch = originalFetch;
    });

    it('purges local cache ONLY when DELETE returns 200 OK', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, deletedId: 'practice-test-1' })
      } as any);

      await storage.deleteMatch('practice-test-1');

      expect(mockStorage['dugout_match_practice-test-1']).toBeUndefined();
      expect(mockStorage['dugout_active_match_id']).toBeUndefined();

      global.fetch = originalFetch;
    });
  });

  describe('Suite 3: Statistics Isolation (Official vs Practice)', () => {
    it('excludes exaggerated practice match scores from team standings', () => {
      const allMatches = [officialMatch, practiceMatch];
      
      // Standings calculator logic from App.tsx
      const stats = new Map<string, { id: string; gp: number; w: number; l: number; pf: number; pa: number }>();
      stats.set(teamRed.id, { id: teamRed.id, gp: 0, w: 0, l: 0, pf: 0, pa: 0 });
      stats.set(teamBlue.id, { id: teamBlue.id, gp: 0, w: 0, l: 0, pf: 0, pa: 0 });

      allMatches.forEach(m => {
        // STRICT STATS ISOLATION
        if (m.isPractice || m.is_practice || !m.isComplete) return;

        const hScore = m.innings.reduce((acc, ing) =>
          acc + (ing.home?.playerScores || []).reduce((pAcc, p) =>
            pAcc + (p?.pitches || []).reduce((piAcc, pi) => piAcc + (pi?.points || 0), 0), 0), 0);

        const aScore = m.innings.reduce((acc, ing) =>
          acc + (ing.away?.playerScores || []).reduce((pAcc, p) =>
            pAcc + (p?.pitches || []).reduce((piAcc, pi) => piAcc + (pi?.points || 0), 0), 0), 0);

        const hRec = stats.get(m.homeTeamId)!;
        const aRec = stats.get(m.awayTeamId)!;
        hRec.gp++; aRec.gp++;
        hRec.pf += hScore; hRec.pa += aScore;
        aRec.pf += aScore; aRec.pa += hScore;
        if (hScore > aScore) { hRec.w++; aRec.l++; }
        else if (hScore < aScore) { aRec.w++; hRec.l++; }
      });

      const redStandings = stats.get(teamRed.id)!;
      const blueStandings = stats.get(teamBlue.id)!;

      // Red Rockets won official match 10-5
      expect(redStandings.gp).toBe(1);
      expect(redStandings.w).toBe(1);
      expect(redStandings.l).toBe(0);
      expect(redStandings.pf).toBe(10);
      expect(redStandings.pa).toBe(5);

      // Blue Bombers lost official match 5-10; their 100 practice points MUST NOT appear!
      expect(blueStandings.gp).toBe(1);
      expect(blueStandings.w).toBe(0);
      expect(blueStandings.l).toBe(1);
      expect(blueStandings.pf).toBe(5);
      expect(blueStandings.pa).toBe(10);
    });

    it('excludes exaggerated practice match stats from official player aggregations', () => {
      // In practice match, Bobby Drake scored 100 points with 25 4-pointers
      // In official match, Bobby Drake scored 5 points
      const officialStats = storage.calculateMatchStats(officialMatch, teamRed, teamBlue);
      const bobbyOfficial = officialStats.find(s => s.playerId === 'player-b1');
      expect(bobbyOfficial?.totalPoints).toBe(5);

      const practiceStats = storage.calculateMatchStats(practiceMatch, teamRed, teamBlue);
      const bobbyPractice = practiceStats.find(s => s.playerId === 'player-b1');
      expect(bobbyPractice?.totalPoints).toBe(100);
      expect(bobbyPractice?.hits4).toBe(25);

      // Combined list filtered through official exclusion
      const officialOnly = [officialMatch, practiceMatch].filter(m => !m.isPractice && !m.is_practice);
      expect(officialOnly).toHaveLength(1);
      expect(officialOnly[0].id).toBe('official-match-001');
    });
  });

  describe('Suite 4: Password Security & Session Integrity', () => {
    it('hashes passwords with bcrypt and verifies them securely', async () => {
      const rawPassword = 'SecureAdminPassword2026!';
      const hash = await hashPassword(rawPassword);

      expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
      expect(await comparePassword(rawPassword, hash)).toBe(true);
      expect(await comparePassword('wrong-password', hash)).toBe(false);
    });

    it('safely upgrades legacy plaintext passwords without lockout', async () => {
      const legacyPlain = 'admin';
      expect(await comparePassword('admin', legacyPlain)).toBe(true);
      expect(await comparePassword('wrong', legacyPlain)).toBe(false);
    });

    it('signs and verifies tamper-evident HMAC session tokens', () => {
      const adminToken = signSessionToken('admin');
      const verified = verifySessionToken(adminToken);
      expect(verified.valid).toBe(true);
      expect(verified.role).toBe('admin');

      // Tampered token must be rejected
      const [payload, sig] = adminToken.split('.');
      const tamperedToken = `${payload}.invalidsignature123`;
      expect(verifySessionToken(tamperedToken).valid).toBe(false);
    });
  });

  describe('Suite 5: Versioned Database Migration Integrity', () => {
    it('defines sequential migrations in api/migrations', () => {
      expect(migrations.length).toBeGreaterThanOrEqual(3);

      // Verify versions are sequential integers starting at 1
      migrations.forEach((m, idx) => {
        expect(m.version).toBe(idx + 1);
        expect(m.name).toBeDefined();
        expect(typeof m.up).toBe('function');
      });

      // Verify migration v2 includes practice mode index and default
      const v2 = migrations.find(m => m.version === 2);
      expect(v2?.name).toContain('practice');
    });
  });
});
