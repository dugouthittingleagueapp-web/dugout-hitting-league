import { describe, it, expect } from "vitest";
import { assessGameDay, leagueToday } from "../../server/gameDayReadiness";
import { scoringFixture } from "../scoring/scoringFixtures";
import { createEmptyInning } from "../../utils/inningTemplate";
const fixture = (homeCount = 3, awayCount = 3) => {
  const f = scoringFixture(homeCount, awayCount);
  return {
    ...f,
    game: {
      ...f.game,
      status: "SCHEDULED" as const,
      startTime: "6:00 pm",
      endTime: "7:00 pm",
      location: "Tunnels 5/6",
    },
  };
};
const check = (f = fixture()) =>
  assessGameDay(
    "2026",
    "2026-11-17",
    [f.game],
    [f.home, f.away],
    [{ id: "QC", season: "2026" }],
  );
describe("Read-only game-day readiness", () => {
  it("reports ready without changing any records", () => {
    const f = fixture();
    const before = JSON.stringify(f);
    expect(check(f).games[0].state).toBe("ready");
    expect(JSON.stringify(f)).toBe(before);
  });
  it("blocks missing teams and wrong destinations", () => {
    const f = fixture();
    f.game.homeTeamId = "missing";
    expect(check(f).games[0].issues.map((i) => i.code)).toContain(
      "TEAMS_MISSING",
    );
    f.game.homeTeamId = f.home.id;
    f.home.season = "2025";
    expect(check(f).games[0].issues.map((i) => i.code)).toContain(
      "TEAM_DESTINATION",
    );
  });
  it.each([2, 3])("accepts %i-player lineups", (count) =>
    expect(check(fixture(count, count)).games[0].state).toBe("ready"),
  );
  it("accepts one regular and substitutes without demanding three regulars", () => {
    const f = fixture(2, 3);
    f.home.subs = [f.home.players.pop()!];
    expect(check(f).games[0].state).toBe("ready");
  });
  it("does not block an unselected weekly lineup", () => {
    const f = fixture();
    f.game.innings = Array.from({ length: 6 }, (_, i) =>
      createEmptyInning(i + 1),
    );
    const result = check(f).games[0];
    expect(result.state).toBe("attention");
    expect(result.issues.map((i) => i.code)).toContain("LINEUP_UNCONFIRMED");
  });
  it("blocks missing lineup players, duplicated IDs and invalid scoring structures", () => {
    const f = fixture();
    f.game.innings[0].home.playerScores[0].playerId = "unknown";
    expect(check(f).games[0].state).toBe("blocked");
    const d = fixture();
    d.home.players[1].id = d.home.players[0].id;
    expect(check(d).games[0].issues.map((i) => i.code)).toContain(
      "ROSTER_IDENTIFIERS",
    );
  });
  it("flags inconsistent completion and scheduled scores including zero", () => {
    const f = fixture();
    f.game.innings[0].home.playerScores[0].pitches[0].points = 0;
    f.game.isComplete = true;
    const codes = check(f).games[0].issues.map((i) => i.code);
    expect(codes).toContain("SCHEDULED_RESULTS");
    expect(codes).toContain("STATUS_MISMATCH");
    f.game.status = undefined as any;
    f.game.isComplete = false;
    const inferred = check(f).games[0].issues.map((i) => i.code);
    expect(inferred).toContain("STATUS_UNKNOWN");
    expect(inferred).toContain("SCHEDULED_RESULTS");
  });
  it("checks overlaps across divisions but isolates seasons and practice games", () => {
    const f = fixture();
    const other = {
      ...f.game,
      id: "other",
      league: "Other",
      homeTeamId: "c",
      awayTeamId: "d",
    };
    const result = assessGameDay(
      "2026",
      "2026-11-17",
      [f.game, other, { ...other, id: "archived", season: "2025" }],
      [f.home, f.away],
      [{ id: "QC", season: "2026" }],
    );
    expect(result.games).toHaveLength(2);
    expect(result.games[0].issues.map((i) => i.code)).toContain(
      "SCHEDULE_CONFLICT",
    );
  });
  it("handles no games and midnight in league time", () => {
    expect(assessGameDay("2027", "2027-11-01", [], [], []).games).toEqual([]);
    expect(leagueToday(new Date("2026-11-18T02:00:00Z"))).toBe("2026-11-17");
  });
});
