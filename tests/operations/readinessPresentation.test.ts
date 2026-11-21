import { describe, it, expect } from "vitest";
import {
  gameDayPresentation,
  gameDayOverview,
} from "../../utils/readinessPresentation";
import { assessGameDay } from "../../server/gameDayReadiness";
import { scoringFixture } from "../scoring/scoringFixtures";
import { createEmptyInning } from "../../utils/inningTemplate";
const ready = () => {
  const f = scoringFixture();
  const game = {
    ...f.game,
    status: "SCHEDULED" as const,
    startTime: "6:00 pm",
    endTime: "7:00 pm",
    location: "Tunnels 5/6",
  };
  return assessGameDay(
    "2026",
    "2026-11-17",
    [game],
    [f.home, f.away],
    [{ id: "QC", season: "2026" }],
  ).games[0];
};
describe("Simple game-day explanations keep all safety warnings", () => {
  it("describes checked scheduling and rosters without promising every phone is synced", () => {
    const view = gameDayPresentation(ready());
    expect(view.label).toBe("Ready for setup");
    expect(view.message).toContain("player lists");
    expect(view.screens).toEqual([]);
  });
  it("treats normal lineup selection as an umpire task, not an admin problem", () => {
    const f = scoringFixture();
    const game = {
      ...f.game,
      status: "SCHEDULED" as const,
      startTime: "18:00",
      endTime: "19:00",
      location: "Tunnels 5/6",
      innings: Array.from({ length: 6 }, (_, i) => createEmptyInning(i + 1)),
    };
    const result = assessGameDay(
      "2026",
      "2026-11-17",
      [game],
      [f.home, f.away],
      [{ id: "QC", season: "2026" }],
    ).games[0];
    expect(result.state).toBe("ready");
    const view = gameDayPresentation(result);
    expect(view.label).toBe("Ready for setup");
    expect(view.tone).toBe("good");
    expect(view.screens).toEqual([]);
    expect(gameDayOverview([result])).toContain("No admin changes needed");
  });
  it("never hides a genuine warning behind a routine lineup reminder", () => {
    const g = ready();
    g.state = "attention";
    g.issues = [
      {
        code: "LINEUP_UNCONFIRMED",
        state: "attention",
        message: "Choose a lineup",
        screen: "game",
      },
      {
        code: "SCHEDULE_CONFLICT",
        state: "attention",
        message: "Both games use Tunnels 5/6 at 6 PM.",
        screen: "schedule",
      },
    ];
    const view = gameDayPresentation(g);
    expect(view.label).toBe("Check before playing");
    expect(view.message).toContain("Both games");
    expect(view.screens).toEqual(["schedule"]);
    expect(gameDayOverview([g])).toBe("1 game needs your attention.");
  });
  it("prioritizes unsafe lineups and retains navigation to every affected screen", () => {
    const g = ready();
    g.state = "blocked";
    g.issues = [
      {
        code: "SCHEDULE_CONFLICT",
        state: "attention",
        message: "Overlap",
        screen: "schedule",
      },
      {
        code: "SCORING_STRUCTURE",
        state: "blocked",
        message: "Invalid scoring structure",
        screen: "game",
      },
    ];
    const before = JSON.stringify(g);
    const view = gameDayPresentation(g);
    expect(view.label).toBe("Fix before playing");
    expect(view.message).toContain("information");
    expect(view.screens).toEqual(["schedule", "game"]);
    expect(JSON.stringify(g)).toBe(before);
  });
  it("does not describe completed or active games as games ready to start", () => {
    const g = ready();
    g.status = "FINAL";
    expect(gameDayPresentation(g).label).toBe("Finished");
    g.status = "IN_PROGRESS";
    expect(gameDayPresentation(g).label).toBe("Under way");
  });
  it("keeps unknown safety issues visible and avoids suggesting that finished results be reopened", () => {
    const g = ready();
    g.status = "FINAL";
    g.state = "blocked";
    g.issues = [
      {
        code: "NEW_RULE",
        state: "blocked",
        message: "Ask the league owner to review this game.",
        screen: "game",
      },
    ];
    const view = gameDayPresentation(g);
    expect(view.label).toBe("Review finished game");
    expect(view.message).toBe(g.issues[0].message);
    expect(view.adminIssues).toHaveLength(1);
  });
});
