import type { Inning } from '../types';

/** Preserve the established 3v2 ghost-pitch format for new, blank innings. */
export const createEmptyInning = (number: number, homeIds: string[] = [], awayIds: string[] = []): Inning => {
  const side = (teamId: 'home' | 'away', ids: string[], other: string[]) => ({
    teamId,
    playerScores: ids.map(playerId => ({
      playerId,
      pitches: Array.from({ length: ids.length === 2 && other.length === 3 ? 15 : 10 }, () => ({ points: null }))
    }))
  });
  return { number, home: side('home', homeIds, awayIds), away: side('away', awayIds, homeIds) };
};
