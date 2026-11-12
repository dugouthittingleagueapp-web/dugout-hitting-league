import type { Match, Team, PlayerStats } from '../types';
import { isForfeitMatch, getForfeitingTeamId } from '../services/matchHelpers';

type MatchStatCalculator = (match: Match, home: Team, away: Team) => PlayerStats[];

export const calculateSeasonStats = (
  matches: Match[],
  teams: Team[],
  league: string | null,
  calculateMatchStats: MatchStatCalculator,
  leaguesMatch: (a?: string | null, b?: string | null) => boolean
): PlayerStats[] => {
  if (!league) return [];
  const aggStats = new Map<string, PlayerStats>();
  const teamById = new Map(teams.map(team => [team.id, team]));

  matches.forEach(m => {
    // Practice games, unfinished games and other leagues never contribute.
    if (m.isPractice || m.is_practice || !m.isComplete ||
        (m.league && !leaguesMatch(m.league, league))) return;
    const home = teamById.get(m.homeTeamId);
    const away = teamById.get(m.awayTeamId);
    if (!home || !away) return;

    const isForfeit = isForfeitMatch(m);
    const forfeitingId = getForfeitingTeamId(m);
    const excludedPlayerIds = new Set<string>();
    if (isForfeit && forfeitingId) {
      const forfeitingTeam = forfeitingId === home.id ? home : (forfeitingId === away.id ? away : null);
      for (const player of [...(forfeitingTeam?.players || []), ...(forfeitingTeam?.subs || [])]) {
        excludedPlayerIds.add(player.id);
      }
    }

    calculateMatchStats(m, home, away).forEach(stat => {
      if (stat.playerId.startsWith('ghost-') || excludedPlayerIds.has(stat.playerId)) return;
      const current = aggStats.get(stat.playerId);
      if (!current) {
        aggStats.set(stat.playerId, { ...stat });
      } else {
        current.totalPoints += stat.totalPoints;
        current.hits4 += stat.hits4;
        current.hits3 += stat.hits3;
        current.hits2 += stat.hits2;
        current.hits1 += stat.hits1;
        current.pitchesSeen += stat.pitchesSeen;
      }
    });
  });
  return Array.from(aggStats.values());
};

export const attachSeasonTeamNames = (seasonStats: PlayerStats[], teams: Team[]) => {
  const teamNames = new Map<string, string>();
  teams.forEach(team => {
    [...(team.players || []), ...(team.subs || [])].forEach(player => {
      teamNames.set(player.id, team.name);
      if (player.name) teamNames.set(player.name.trim().toLowerCase(), team.name);
    });
  });
  return seasonStats.map(stat => ({
    ...stat,
    teamName: teamNames.get(stat.playerId) || teamNames.get(stat.name.trim().toLowerCase()) || '',
  }));
};
