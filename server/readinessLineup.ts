import type { Match, Team } from "../types";

/** Missing player records need admin help; ordinary blank selections do not. */
export const unavailableLineupTeams = (
  match: Match,
  home: Team,
  away: Team,
): string[] => {
  const missing = new Set<string>();
  for (const [side, team] of [
    ["home", home],
    ["away", away],
  ] as const) {
    const ids = new Set(
      [...team.players, ...(team.subs || [])].map((p) => p.id),
    );
    for (const inning of Array.isArray(match.innings) ? match.innings : []) {
      const players = inning?.[side]?.playerScores;
      if (
        Array.isArray(players) &&
        players.some(
          (p) => !p || typeof p.playerId !== "string" || !ids.has(p.playerId),
        )
      )
        missing.add(team.name);
    }
    for (const round of Array.isArray(match.tieBreaker)
      ? match.tieBreaker
      : []) {
      const id = side === "home" ? round?.homePlayerId : round?.awayPlayerId;
      if (typeof id !== "string" || !ids.has(id)) missing.add(team.name);
    }
  }
  return [...missing];
};

/** Accept only intact, blank pregame templates whose missing choices an umpire
 * can finish. This never repairs data or relaxes the actual scoring API rules. */
export const isUnselectedLineup = (match: Match): boolean => {
  if (
    (match.status && match.status !== "SCHEDULED") ||
    match.isComplete ||
    match.tieBreaker?.length ||
    !Array.isArray(match.innings) ||
    match.innings.length !== 6
  )
    return false;
  return match.innings.every((inning, index) => {
    if (inning?.number !== index + 1) return false;
    const home = inning.home?.playerScores,
      away = inning.away?.playerScores;
    if (
      !Array.isArray(home) ||
      !Array.isArray(away) ||
      home.length > 3 ||
      away.length > 3
    )
      return false;
    if (
      new Set([...home, ...away].map((p) => p?.playerId)).size !==
      home.length + away.length
    )
      return false;
    return (["home", "away"] as const).every((side) => {
      const players = inning[side].playerScores,
        other = side === "home" ? away : home;
      if (
        ![side, side === "home" ? match.homeTeamId : match.awayTeamId].includes(
          inning[side].teamId,
        )
      )
        return false;
      return players.every(
        (p) =>
          p &&
          Array.isArray(p.pitches) &&
          p.pitches.length ===
            (players.length === 2 && other.length === 3 ? 15 : 10) &&
          p.pitches.every((pitch) => pitch?.points === null),
      );
    });
  });
};
