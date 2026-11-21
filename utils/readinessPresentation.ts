import type { ReadyGame } from "../server/gameDayReadiness";

/** Presentation only. Server assessments and start/scoring rules stay unchanged. */
export const gameDayPresentation = (game: ReadyGame) => {
  const adminIssues = game.issues.filter(
    (issue) => issue.code !== "LINEUP_UNCONFIRMED",
  );
  const primary =
    adminIssues.find((issue) => issue.state === "blocked") || adminIssues[0];
  const finished = game.status === "FINAL";
  let label = "Ready for setup",
    tone: "good" | "calm" | "review" | "fix" = "good";
  let message = "The schedule and player lists look good.";
  if (primary) {
    tone = game.state === "blocked" ? "fix" : "review";
    label = finished
      ? "Review finished game"
      : tone === "fix"
        ? "Fix before playing"
        : "Check before playing";
    const simple: Record<string, string> = {
      TEAMS_MISSING: "Choose two different teams for this game.",
      TEAM_DESTINATION:
        "Check that both teams are in the correct league and season.",
      ROSTER_INVALID: "Check the player lists for these teams.",
      ROSTER_IDENTIFIERS:
        "Check the team rosters for missing names or duplicate players.",
      SCORING_STRUCTURE:
        "This game’s saved lineup needs to be checked before scoring.",
      STATUS_UNKNOWN: "Check this game’s saved status before continuing.",
      STATUS_MISMATCH:
        "The game’s status and saved result need to be reviewed.",
      SCHEDULED_RESULTS:
        "This game already has results but is still marked Scheduled. Review it before continuing.",
    };
    message = simple[primary.code] || primary.message;
  } else if (finished) {
    label = "Finished";
    message = "This game is complete.";
  } else if (game.status === "IN_PROGRESS") {
    label = "Under way";
    message = "This game has started.";
  } else if (game.issues.some((issue) => issue.code === "LINEUP_UNCONFIRMED")) {
    label = "Lineup at game time";
    tone = "calm";
    message =
      "The umpire chooses who is playing when starting the game. No admin change is needed.";
  }
  const screens = [...new Set(adminIssues.map((issue) => issue.screen))];
  return { label, tone, message, adminIssues, screens };
};
export const gameDayOverview = (games: ReadyGame[]) => {
  const count = games.filter(
    (game) => gameDayPresentation(game).adminIssues.length > 0,
  ).length;
  return count
    ? `${count} game${count === 1 ? " needs" : "s need"} your attention.`
    : "No admin changes needed for these games.";
};
export const simpleReadinessCheck = (text: string): string =>
  ({
    "Teams belong to this league and season.":
      "Both teams are in the right league and season.",
    "Date, times and tunnels are valid.": "Date, time and tunnels are set.",
    "No overlapping cage or team bookings.":
      "No team or tunnel is booked twice.",
    "Roster player references are usable, including substitutes.":
      "Player lists checked, including substitutes.",
    "Saved lineup and scoring structure are compatible.":
      "Saved lineup checked.",
  })[text] || text;
