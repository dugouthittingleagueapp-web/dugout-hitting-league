// Preserve case-insensitive, whitespace-tolerant league identity rules.
export const normalizeLeague = (league?: string | null): string => {
  return (league || '').trim().toLowerCase();
};

export const leaguesMatch = (leagueA?: string | null, leagueB?: string | null): boolean => {
  if (!leagueA || !leagueB) return false;
  return normalizeLeague(leagueA) === normalizeLeague(leagueB);
};

