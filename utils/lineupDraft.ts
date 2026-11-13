/**
 * Draft-only batting order editing. A user may temporarily remove all regulars
 * while replacing them with substitutes. Never save/start an incomplete lineup.
 */
export const removeDraftLineupPlayer = <T extends { id: string }>(
  lineup: readonly T[],
  playerId: string
): T[] => lineup.filter(player => player.id !== playerId);

export const isPlayableLineup = (ids: readonly string[]): boolean =>
  ids.length >= 2 && ids.length <= 3 &&
  ids.every(Boolean) && new Set(ids).size === ids.length;

export const incompleteLineupMessage = (teamName: string): string =>
  `${teamName} needs 2 or 3 batters before you can save or start the game. Add regular players or substitutes to finish the lineup.`;
