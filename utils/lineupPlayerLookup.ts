import type { Player, Team } from '../types';

/**
 * Resolve legacy lineup identifiers for DISPLAY ONLY. Saved player IDs and
 * scoring records are never rewritten by this function.
 *
 * Prefer exact roster IDs over matching names, because teammates can share
 * names and older scorecards may contain name-based entries.
 */
export const resolveLineupPlayer = (
  id: string,
  primaryTeam: Team | undefined,
  homeTeam: Team | undefined,
  awayTeam: Team | undefined
): Player | undefined => {
  const allPlayers = [
    ...(primaryTeam?.players || []),
    ...(primaryTeam?.subs || []),
    ...(homeTeam?.players || []),
    ...(homeTeam?.subs || []),
    ...(awayTeam?.players || []),
    ...(awayTeam?.subs || []),
  ];
  const key = String(id ?? '').trim();
  if (!key) return undefined;

  const exact = allPlayers.find(player => String(player.id ?? '').trim() === key);
  if (exact) return exact;

  const normalized = key.toLocaleLowerCase();
  const normalizedId = allPlayers.find(
    player => String(player.id ?? '').trim().toLocaleLowerCase() === normalized
  );
  if (normalizedId) return normalizedId;

  return allPlayers.find(player => {
    const first = String(player.name || '').trim();
    const last = String(player.lastName || '').trim();
    const full = `${first} ${last}`.trim();
    return [first, full, `${first} ${last ? `${last.charAt(0)}.` : ''}`.trim()]
      .some(name => name && name.toLocaleLowerCase() === normalized);
  });
};
