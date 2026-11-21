import { describe, it, expect } from "vitest";
import { leagueDayBoundary, leagueToday } from "../../utils/leagueClock";
describe("Consistent league calendar boundaries", () => {
  it("includes evening games after UTC midnight in the same league day", () => {
    expect(leagueDayBoundary("2026-11-20").toISOString()).toBe(
      "2026-11-20T05:00:00.000Z",
    );
    expect(leagueDayBoundary("2026-11-20", true).toISOString()).toBe(
      "2026-11-21T04:59:59.999Z",
    );
    expect(leagueToday(new Date("2026-11-21T01:00:00Z"))).toBe("2026-11-20");
  });
  it.each([
    ["2026-03-08", 23],
    ["2026-11-01", 25],
  ])("handles DST on %s", (date, hours) =>
    expect(
      (leagueDayBoundary(String(date), true).getTime() -
        leagueDayBoundary(String(date)).getTime() +
        1) /
        3600000,
    ).toBe(hours),
  );
  it.each(["2026-02-30", "bad", "2026-11-20T00:00:00Z"])(
    "rejects invalid dates %s",
    (date) => expect(() => leagueDayBoundary(date)).toThrow(),
  );
});
