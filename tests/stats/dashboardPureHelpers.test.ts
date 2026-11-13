import { describe, expect, it } from 'vitest';
import type { Match, Team, PlayerStats } from '../../types';
import { groupMatchesByWeek, getWeekKey } from '../../utils/scheduleWeeks';
import { calculateSeasonStats, attachSeasonTeamNames } from '../../utils/seasonStats';

const team = (id: string, name: string, players: string[]): Team => ({
  id, name, league: '11U', season: '2026',
  players: players.map(p => ({ id: p, name: p })),
});
const match = (id: string, date: string, options: Partial<Match> = {}): Match => ({
  id, league: '11U', season: '2026', homeTeamId: 'home', awayTeamId: 'away',
  date, status: 'FINAL', isComplete: true, is_practice: false, innings: [],
  ...options,
});
const stat = (playerId: string, points: number): PlayerStats => ({
  playerId, name: playerId, totalPoints: points,
  hits4: 0, hits3: points, hits2: 0, hits1: 0, pitchesSeen: 1,
});
const leaguesMatch = (a?: string | null, b?: string | null) =>
  a?.trim().toLowerCase() === b?.trim().toLowerCase();

describe('Dashboard calculations', () => {
  it('groups matches by ISO week across a year boundary, keeping week labels chronological', () => {
    expect(getWeekKey('2026-12-31')).toBe('2026-W53');
    expect(getWeekKey('2027-01-01')).toBe('2026-W53');
    const games = [
      match('later', '2027-01-10'),
      match('earlier', '2026-12-30'),
      match('same-week', '2027-01-01'),
      match('other-league', '2026-12-30', { league: '12U' }),
    ];
    const grouped = groupMatchesByWeek(games, ' 11u ', leaguesMatch);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].id).toBe('2026-W53');
    expect(grouped[0].label).toBe('Week 1');
    expect(grouped[0].matches.map(m => m.id)).toEqual(['earlier', 'same-week']);
    expect(grouped[1].matches.map(m => m.id)).toEqual(['later']);
    expect(groupMatchesByWeek(games, null, leaguesMatch)).toEqual([]);
  });

  it('excludes practice, unfinished, ghost and forfeiting-team stats', () => {
    const teams = [team('home', 'Tigers', ['home-p1']), team('away', 'Bears', ['away-p1'])];
    const games = [
      match('official', '2026-11-01'),
      match('practice', '2026-11-02', { isPractice: true, is_practice: true }),
      match('unfinished', '2026-11-03', { isComplete: false }),
      match('other', '2026-11-04', { league: '12U' }),
      match('forfeit', '2026-11-05', { isForfeit: true, forfeitingTeamId: 'home' }),
    ];
    const calculateMatchStats = (_m: Match, _h: Team, _a: Team) => [
      stat('home-p1', 3), stat('away-p1', 2), stat('ghost-something', 4),
    ];
    const results = calculateSeasonStats(games, teams, '11U', calculateMatchStats, leaguesMatch);
    expect(results).toEqual([stat('home-p1', 3), { ...stat('away-p1', 2), totalPoints: 4, hits3: 4, pitchesSeen: 2 }]);
  });

  it('attaches team names by roster ID, including registered substitutes', () => {
    const teams = [team('home', 'Tigers', ['home-p1']), team('away', 'Bears', ['away-p1'])];
    teams[0].subs = [{ id: 'sub-1', name: 'Alex' }];
    const mapped = attachSeasonTeamNames([stat('sub-1', 2), stat('away-p1', 3)], teams);
    expect(mapped.map(s => s.teamName)).toEqual(['Tigers', 'Bears']);
  });
});
