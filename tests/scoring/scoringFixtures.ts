import type { Match, Team } from '../../types';
import { createEmptyInning } from '../../utils/inningTemplate';

export const scoringFixture = (homeCount = 3, awayCount = 3) => {
  const home: Team = { id: 'home', name: 'Home Test', league: 'QC', season: '2026',
    players: Array.from({ length: homeCount }, (_, i) => ({ id: `h${i + 1}`, name: `Home ${i + 1}` })), subs: [{ id: 'hsub', name: 'Home Sub' }] };
  const away: Team = { id: 'away', name: 'Away Test', league: 'QC', season: '2026',
    players: Array.from({ length: awayCount }, (_, i) => ({ id: `a${i + 1}`, name: `Away ${i + 1}` })), subs: [] };
  const game: Match = { id: 'journal-test', revision: 0, league: 'QC', season: '2026',
    homeTeamId: home.id, awayTeamId: away.id, date: '2026-11-17', status: 'IN_PROGRESS', isComplete: false, is_practice: false,
    innings: Array.from({ length: 6 }, (_, i) => createEmptyInning(i + 1, home.players.map(p => p.id), away.players.map(p => p.id))) };
  return { home, away, game };
};
export const memoryScoringStorage = () => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear(),
  };
};
