import { scheduleDateKey } from "./scheduleValidation.js";
export const LEAGUE_TIME_ZONE = "America/New_York";
export const leagueToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: LEAGUE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
/** UTC instant for a league calendar day's boundary, including 23/25-hour days. */
export const leagueDayBoundary = (date: string, end = false): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !scheduleDateKey(date))
    throw Error("Choose a valid calendar date.");
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day + (end ? 1 : 0));
  let instant = target;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: LEAGUE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
    const observed = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    instant += target - observed;
  }
  return new Date(instant - (end ? 1 : 0));
};
