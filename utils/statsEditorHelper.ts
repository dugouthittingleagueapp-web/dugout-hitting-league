import { Match, Team, Player, Inning, TieBreakerRound } from '../types.js';

/**
 * Checks if a player's name is a generic placeholder (e.g. "C-C-Crushers! Player 1", "Player 2", "Sub").
 */
export const isPlaceholderPlayerName = (name?: string | null): boolean => {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/^.*player\s*\d+$/i.test(trimmed)) return true;
  if (/^player\s*\d+$/i.test(trimmed)) return true;
  if (/^sub\s*\d*$/i.test(trimmed)) return true;
  if (/^generic\s*sub$/i.test(trimmed)) return true;
  if (/^placeholder$/i.test(trimmed)) return true;
  if (/^unknown$/i.test(trimmed)) return true;
  if (/^tbd$/i.test(trimmed)) return true;
  if (/^n\/a$/i.test(trimmed)) return true;
  return false;
};

export interface MatchPlayerStatSummary {
  playerId: string;
  currentName: string;
  isPlaceholder: boolean;
  totalPoints: number;
  hits4: number;
  hits3: number;
  hits2: number;
  hits1: number;
  pitchesSeen: number;
  side: 'home' | 'away';
}

/**
 * Extracts all distinct players recorded in a match's innings for a specific team,
 * calculating their raw points and identifying if they are placeholders.
 */
export const extractMatchPlayerSummary = (
  match: Match,
  teamId: string,
  team?: Team
): MatchPlayerStatSummary[] => {
  const isHome = match.homeTeamId === teamId;
  const side: 'home' | 'away' = isHome ? 'home' : 'away';

  const statsMap = new Map<string, MatchPlayerStatSummary>();

  const allTeamPlayers = [...(team?.players || []), ...(team?.subs || [])];

  (match.innings || []).forEach(inning => {
    if (!inning) return;
    const teamScore = side === 'home' ? inning.home : inning.away;
    if (!teamScore?.playerScores) return;

    teamScore.playerScores.forEach(ps => {
      if (!ps || !ps.playerId) return;

      if (!statsMap.has(ps.playerId)) {
        const found = allTeamPlayers.find(p => p.id === ps.playerId);
        const name = found ? `${found.name}${found.lastName ? ' ' + found.lastName : ''}` : 'Sub';
        statsMap.set(ps.playerId, {
          playerId: ps.playerId,
          currentName: name,
          isPlaceholder: isPlaceholderPlayerName(name),
          totalPoints: 0,
          hits4: 0,
          hits3: 0,
          hits2: 0,
          hits1: 0,
          pitchesSeen: 0,
          side
        });
      }

      const stat = statsMap.get(ps.playerId)!;
      (ps.pitches || []).forEach(pitch => {
        if (pitch && pitch.points !== null && pitch.points !== undefined) {
          stat.pitchesSeen++;
          stat.totalPoints += pitch.points;
          if (pitch.points === 4) stat.hits4++;
          else if (pitch.points === 3) stat.hits3++;
          else if (pitch.points === 2) stat.hits2++;
          else if (pitch.points === 1) stat.hits1++;
        }
      });
    });
  });

  return Array.from(statsMap.values());
};

/**
 * Deep-clones a match and replaces old player IDs with newly mapped player IDs
 * across all innings and tie breaker rounds.
 */
export const remapMatchPlayerIds = (
  match: Match,
  playerMapping: Record<string, string> // oldPlayerId -> newPlayerId
): Match => {
  const cloned: Match = JSON.parse(JSON.stringify(match));

  if (Array.isArray(cloned.innings)) {
    cloned.innings.forEach(inning => {
      ['home', 'away'].forEach(sideKey => {
        const teamInning = (inning as any)[sideKey];
        if (teamInning?.playerScores && Array.isArray(teamInning.playerScores)) {
          teamInning.playerScores.forEach((ps: any) => {
            if (ps.playerId && playerMapping[ps.playerId]) {
              ps.playerId = playerMapping[ps.playerId];
            }
          });
        }
      });
    });
  }

  if (Array.isArray(cloned.tieBreaker)) {
    cloned.tieBreaker.forEach(tb => {
      if (tb.homePlayerId && playerMapping[tb.homePlayerId]) {
        tb.homePlayerId = playerMapping[tb.homePlayerId];
      }
      if (tb.awayPlayerId && playerMapping[tb.awayPlayerId]) {
        tb.awayPlayerId = playerMapping[tb.awayPlayerId];
      }
    });
  }

  return cloned;
};

/**
 * Generates an automatic 1-to-1 mapping from placeholder player entries to official roster players in slot order.
 */
export const autoMapPlaceholdersToRoster = (
  placeholderSummaries: MatchPlayerStatSummary[],
  officialRoster: Player[]
): Record<string, string> => {
  const mapping: Record<string, string> = {};
  placeholderSummaries.forEach((summary, idx) => {
    if (officialRoster[idx]) {
      mapping[summary.playerId] = officialRoster[idx].id;
    }
  });
  return mapping;
};
