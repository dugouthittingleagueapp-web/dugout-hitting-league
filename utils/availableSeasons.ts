/**
 * Keep the existing season picker ordering and archive visibility in one
 * pure helper. The caller decides what to cache and when to fetch.
 */
export const mergeAvailableSeasons = (seasons: string[], currentSeason: string): string[] =>
  Array.from(new Set([...seasons, '2026', '2025', currentSeason]))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
