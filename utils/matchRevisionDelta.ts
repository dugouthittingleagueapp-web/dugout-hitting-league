import type { MatchRevision } from '../services/storageService';

/**
 * Compare compact database fingerprints, without interpreting score totals.
 * A pitch changing from 1 to 0 (or a forfeit correction) must still refresh
 * the entire match used by standings and per-player statistics.
 */
export const getMatchRevisionDelta = (
  previous: MatchRevision[],
  latest: MatchRevision[]
): { changedIds: string[]; removedIds: string[] } => {
  const old = new Map(previous.map(({ id, revision }) => [id, revision]));
  const next = new Set(latest.map(({ id }) => id));
  return {
    changedIds: latest.filter(row => old.get(row.id) !== row.revision).map(row => row.id),
    removedIds: previous.filter(row => !next.has(row.id)).map(row => row.id)
  };
};
