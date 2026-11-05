import { describe, it, expect } from 'vitest';
import {
  migrateCrushersInDbData,
  isDuplicateCrushersName,
  isOfficialCrushersName,
  OFFICIAL_TEAM_NAME
} from '../../utils/crushersMigration';
import { Match, Team, Inning } from '../../types';
import { calculateMatchStats } from '../../services/storageService';

describe('Crushers Migration & Team Merge', () => {
  const createMockInning = (number: number, homePid: string, awayPid: string, points = 3): Inning => ({
    number,
    home: {
      teamId: 'home',
      playerScores: [{ playerId: homePid, pitches: [{ points }, { points: 1 }] }]
    },
    away: {
      teamId: 'away',
      playerScores: [{ playerId: awayPid, pitches: [{ points: 4 }, { points: 2 }] }]
    }
  });

  it('validates duplicate and official team names accurately', () => {
    expect(isDuplicateCrushersName('C-C-Crushers')).toBe(true);
    expect(isDuplicateCrushersName('c-c-crushers')).toBe(true);
    expect(isDuplicateCrushersName(' C-C-Crushers ')).toBe(true);
    expect(isDuplicateCrushersName('C-C-Crushers!')).toBe(false);
    expect(isDuplicateCrushersName('Banana Bros')).toBe(false);

    expect(isOfficialCrushersName('C-C-Crushers!')).toBe(true);
    expect(isOfficialCrushersName('c-c-crushers!')).toBe(true);
    expect(isOfficialCrushersName('C-C-Crushers')).toBe(false);
  });

  it('merges duplicate team into official team, updating games, stats, and removing duplicate', () => {
    const officialTeam: Team = {
      id: 'team-official-crushers',
      name: 'C-C-Crushers!',
      league: '9U 3v3',
      season: '2026',
      players: [
        { id: 'p-official-1', name: 'C-C-Crushers! Player 1' },
        { id: 'p-official-2', name: 'C-C-Crushers! Player 2' }
      ],
      subs: []
    };

    const duplicateTeam: Team = {
      id: 'team-duplicate-crushers',
      name: 'C-C-Crushers',
      league: '9U 3v3',
      season: '2026',
      players: [
        { id: 'p-dup-1', name: 'Jack Robinson' },
        { id: 'p-dup-2', name: 'Sammy Sosa' }
      ],
      subs: [{ id: 'p-dup-sub', name: 'Ken Griffey' }]
    };

    const opponentTeam: Team = {
      id: 'team-opponent',
      name: 'AYRA Bright',
      league: '9U 3v3',
      season: '2026',
      players: [{ id: 'p-opp-1', name: 'Opponent Batter' }],
      subs: []
    };

    // 1. Last night's finalized game where duplicate team was used as Away team
    const lastNightFinalizedGame: Match = {
      id: 'match-last-night',
      league: '9U 3v3',
      season: '2026',
      date: '2026-11-02T18:00:00.000Z',
      homeTeamId: opponentTeam.id,
      awayTeamId: duplicateTeam.id,
      isComplete: true,
      status: 'FINAL',
      is_practice: false,
      innings: [
        createMockInning(1, 'p-opp-1', 'p-dup-1', 4),
        createMockInning(2, 'p-opp-1', 'p-dup-2', 3)
      ],
      tieBreaker: [
        {
          roundNumber: 1,
          pitchLimit: 1,
          homePlayerId: 'p-opp-1',
          awayPlayerId: 'p-dup-1',
          homeScores: [2],
          awayScores: [4]
        }
      ]
    };

    // 2. Future scheduled match where duplicate team was scheduled as Home team
    const futureScheduledGame: Match = {
      id: 'match-future-week',
      league: '9U 3v3',
      season: '2026',
      date: '2026-11-09T19:15:00.000Z',
      homeTeamId: duplicateTeam.id,
      awayTeamId: opponentTeam.id,
      isComplete: false,
      status: 'SCHEDULED',
      is_practice: false,
      innings: [createMockInning(1, 'p-dup-1', 'p-opp-1', 0)]
    };

    const db = {
      teams: [officialTeam, duplicateTeam, opponentTeam],
      matches: [lastNightFinalizedGame, futureScheduledGame]
    };

    const result = migrateCrushersInDbData(db);

    expect(result.success).toBe(true);
    expect(result.teamsMerged).toBe(1);
    expect(result.matchesUpdated).toBe(2);
    expect(result.finalizedMatchesUpdated).toBe(1);
    expect(result.scheduledMatchesUpdated).toBe(1);

    // 1. Duplicate team should be removed from teams array
    expect(db.teams.find(t => t.id === duplicateTeam.id)).toBeUndefined();

    // 2. Official team should remain with official name
    const primary = db.teams.find(t => t.id === officialTeam.id);
    expect(primary).toBeDefined();
    expect(primary?.name).toBe(OFFICIAL_TEAM_NAME);

    // 3. Players from duplicate team should be preserved in official team roster
    const playerNames = primary?.players.map(p => p.name);
    expect(playerNames).toContain('Jack Robinson');
    expect(playerNames).toContain('Sammy Sosa');

    // 4. Last night's finalized game should point to official team ID
    const migratedLastNight = db.matches.find(m => m.id === 'match-last-night');
    expect(migratedLastNight?.awayTeamId).toBe(officialTeam.id);
    expect(migratedLastNight?.isComplete).toBe(true);

    // 5. Inning box scores and tie-breaker must point to official team player IDs
    const jackInRoster = primary?.players.find(p => p.name === 'Jack Robinson');
    expect(jackInRoster).toBeDefined();
    // Jack's player ID should be the one in the inning box score
    expect(migratedLastNight?.innings[0].away.playerScores[0].playerId).toBe(jackInRoster!.id);
    expect(migratedLastNight?.tieBreaker?.[0].awayPlayerId).toBe(jackInRoster!.id);

    // 6. Match stats calculation should associate hits/points to players under C-C-Crushers!
    const stats = calculateMatchStats(migratedLastNight!, opponentTeam, primary!);
    const jackStats = stats.find(s => s.playerId === jackInRoster!.id);
    expect(jackStats).toBeDefined();
    expect(jackStats!.name).toContain('Jack');
    expect(jackStats!.totalPoints).toBeGreaterThan(0);

    // 7. Future scheduled game should point to official team ID
    const migratedFuture = db.matches.find(m => m.id === 'match-future-week');
    expect(migratedFuture?.homeTeamId).toBe(officialTeam.id);
    expect(migratedFuture?.awayTeamId).toBe(opponentTeam.id);
  });

  it('renames team if only duplicate C-C-Crushers exists without official team', () => {
    const duplicateTeam: Team = {
      id: 'team-lone-crushers',
      name: 'C-C-Crushers',
      league: '10u',
      season: '2026',
      players: [{ id: 'p1', name: 'Player One' }],
      subs: []
    };

    const db = {
      teams: [duplicateTeam],
      matches: []
    };

    const result = migrateCrushersInDbData(db);

    expect(result.teamsRenamed).toBe(1);
    expect(db.teams[0].name).toBe(OFFICIAL_TEAM_NAME);
  });

  it('does nothing when no duplicates exist', () => {
    const officialTeam: Team = {
      id: 'team-clean',
      name: 'C-C-Crushers!',
      league: '9U 3v3',
      season: '2026',
      players: [],
      subs: []
    };

    const db = {
      teams: [officialTeam],
      matches: []
    };

    const result = migrateCrushersInDbData(db);
    expect(result.teamsMerged).toBe(0);
    expect(result.teamsRenamed).toBe(0);
    expect(result.matchesUpdated).toBe(0);
  });
});
