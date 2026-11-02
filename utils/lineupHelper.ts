import { Match, Inning, PlayerInningScore } from '../types';

/**
 * Re-orders and applies new home and away batting orders to all innings of a match.
 * Preserves any already recorded pitches for existing players while ensuring:
 * - The playerScores array reflects the exact batting order (index 0 = Batter 1, index 1 = Batter 2, index 2 = Batter 3)
 * - Pitch counts conform to league standards (10 pitches each for 3v3 or 2v2, 15 pitches for the short side in 3v2/2v3 Ghost Mode)
 */
export const applyLineupToMatch = (
  match: Match,
  newHomePlayerIds: string[],
  newAwayPlayerIds: string[],
  options?: { startFromInningIdx?: number }
): Match => {
  const homeCount = newHomePlayerIds.length;
  const awayCount = newAwayPlayerIds.length;

  let homePitchCount = 10;
  let awayPitchCount = 10;

  if (homeCount === 2 && awayCount === 3) {
    homePitchCount = 15; // Ghost Mode for Home
  } else if (awayCount === 2 && homeCount === 3) {
    awayPitchCount = 15; // Ghost Mode for Away
  }

  const startIdx = options?.startFromInningIdx ?? 0;

  const syncTeamPlayerScores = (
    existingScores: PlayerInningScore[] | undefined,
    playerIds: string[],
    targetPitchCount: number
  ): PlayerInningScore[] => {
    return playerIds.map(pid => {
      const found = existingScores?.find(p => p.playerId === pid);
      if (found) {
        const curLen = found.pitches?.length || 0;
        if (curLen === targetPitchCount) {
          return { playerId: pid, pitches: [...found.pitches] };
        }
        if (curLen < targetPitchCount) {
          const extra = Array(targetPitchCount - curLen)
            .fill(null)
            .map(() => ({ points: null }));
          return {
            playerId: pid,
            pitches: [...(found.pitches || []), ...extra],
          };
        }
        return {
          playerId: pid,
          pitches: found.pitches.slice(0, targetPitchCount),
        };
      }

      return {
        playerId: pid,
        pitches: Array(targetPitchCount)
          .fill(null)
          .map(() => ({ points: null })),
      };
    });
  };

  const updatedInnings: Inning[] = (match.innings || []).map((inning, idx) => {
    if (idx < startIdx) {
      return inning;
    }

    return {
      ...inning,
      home: {
        teamId: 'home',
        playerScores: syncTeamPlayerScores(
          inning.home?.playerScores,
          newHomePlayerIds,
          homePitchCount
        ),
      },
      away: {
        teamId: 'away',
        playerScores: syncTeamPlayerScores(
          inning.away?.playerScores,
          newAwayPlayerIds,
          awayPitchCount
        ),
      },
    };
  });

  return {
    ...match,
    innings: updatedInnings,
  };
};

/**
 * Moves a batter up (earlier) in the batting order.
 */
export const moveBatterUp = (playerIds: string[], index: number): string[] => {
  if (index <= 0 || index >= playerIds.length) return [...playerIds];
  const copy = [...playerIds];
  const temp = copy[index - 1];
  copy[index - 1] = copy[index];
  copy[index] = temp;
  return copy;
};

/**
 * Moves a batter down (later) in the batting order.
 */
export const moveBatterDown = (playerIds: string[], index: number): string[] => {
  if (index < 0 || index >= playerIds.length - 1) return [...playerIds];
  const copy = [...playerIds];
  const temp = copy[index + 1];
  copy[index + 1] = copy[index];
  copy[index] = temp;
  return copy;
};
