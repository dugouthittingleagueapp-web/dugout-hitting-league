import { describe, expect, it } from 'vitest';
import { mapMatchFromDB, mapTeamFromDB } from '../../utils/dbMappers';

describe('Database row mapping — legacy behavior', () => {
  it('maps Postgres match rows and parses stored inning and tie-breaker JSON', () => {
    const innings = [{ number: 1, home: { teamId: 'h', playerScores: [] }, away: { teamId: 'a', playerScores: [] } }];
    const tieBreaker = [{ roundNumber: 1, pitchLimit: 5, homePlayerId: 'p1', awayPlayerId: 'p2', homeScores: [2], awayScores: [0] }];
    const row = {
      id: 'match-1', revision: '9', league: '11U', date: '2026-11-11',
      home_team_id: 'home', away_team_id: 'away', season: '2026',
      is_complete: true, is_practice: true, is_forfeit: true, status: 'FINAL',
      innings: JSON.stringify(innings), tie_breaker: JSON.stringify(tieBreaker),
      forfeiting_team_id: 'home', winning_team_id: 'away',
      forfeit_reason: 'forfeit', start_time: '15:00', end_time: '16:00'
    };
    const result = mapMatchFromDB(row);
    expect(result).toMatchObject({
      id: 'match-1', revision: 9, homeTeamId: 'home', awayTeamId: 'away',
      season: '2026', isComplete: true, isPractice: true, is_practice: true,
      isForfeit: true, is_forfeit: true, forfeitingTeamId: 'home',
      forfeiting_team_id: 'home', winningTeamId: 'away',
      winning_team_id: 'away', forfeitReason: 'forfeit',
      forfeit_reason: 'forfeit', startTime: '15:00', endTime: '16:00'
    });
    expect(result.innings).toEqual(innings);
    expect(result.tieBreaker).toEqual(tieBreaker);
  });

  it('preserves 2025 archive fallback and earlier camelCase match records', () => {
    const innings: any[] = [];
    const row = {
      id: 'legacy-1', league: '10U', date: '2025-07-18',
      homeTeamId: 'legacy-home', awayTeamId: 'legacy-away',
      isComplete: false, isPractice: true, isForfeit: false,
      innings, tieBreaker: [], forfeitReason: 'legacy note'
    };
    const mapped = mapMatchFromDB(row);
    expect(mapped).toMatchObject({
      id: 'legacy-1', revision: 0, season: '2025',
      homeTeamId: 'legacy-home', awayTeamId: 'legacy-away',
      isComplete: false, isPractice: true, is_practice: true,
      isForfeit: false, is_forfeit: false
    });
    expect(mapped.innings).toBe(innings);
    expect(mapped.tieBreaker).toEqual([]); // Legacy camelCase array is returned unchanged.
  });

  it('gives explicit database flags precedence over legacy flags', () => {
    const mapped = mapMatchFromDB({
      id: 'm', league: '10U', season: '2026', date: '2026-01-01',
      home_team_id: 'h', away_team_id: 'a', innings: [],
      is_practice: false, isPractice: true,
      is_forfeit: false, isForfeit: true,
      is_complete: false, isComplete: true
    });
    expect(mapped.isPractice).toBe(false);
    expect(mapped.isForfeit).toBe(false);
    expect(mapped.isComplete).toBe(false);
  });

  it('parses team rosters and keeps legacy team season/substitute defaults', () => {
    const players = [{ id: 'player-1', name: 'Alex' }];
    expect(mapTeamFromDB({
      id: 'team-1', name: 'Tigers', league: '11U',
      players: JSON.stringify(players), subs: JSON.stringify([])
    })).toMatchObject({ season: '2025', players, subs: [] });
    const team = mapTeamFromDB({
      id: 'team-2', name: 'Bears', league: '11U',
      season: '2026', players, subs: null
    });
    expect(team.players).toBe(players);
    expect(team.subs).toEqual([]);
  });
});
