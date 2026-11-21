import React, { useEffect, useState } from "react";
import { getAdminOperations } from "../services/storageService";
import type { ReadinessResult } from "../server/gameDayReadiness";
import { leagueToday } from "../utils/leagueClock";
import {
  displayBookingTime,
  displayScheduleDate,
} from "../utils/scheduleConflictPresentation";
import {
  gameDayPresentation,
  gameDayOverview,
  simpleReadinessCheck,
} from "../utils/readinessPresentation";

const toneClasses = {
  good: "bg-emerald-950 text-emerald-300",
  review: "bg-amber-950 text-amber-200",
  fix: "bg-red-950 text-red-200",
};
const actionLabels = {
  schedule: "Fix schedule",
  rosters: "Edit roster",
  game: "Review game",
};
export const GameDayReadiness: React.FC<{
  season: string;
  date: string;
  onDateChange: (date: string) => void;
  onNavigate: (screen: "schedule" | "rosters" | "game") => void;
}> = ({ season, date, onDateChange: setDate, onNavigate }) => {
  const [dates, setDates] = useState<string[]>([]);
  const [data, setData] = useState<ReadinessResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    setData(null);
    getAdminOperations<ReadinessResult>("readiness", season, { date })
      .then((result) => {
        if (active) {
          setData(result);
          setDates(result.dates);
        }
      })
      .catch(() => {
        if (active)
          setError(
            "We couldn’t check these games. Choose Check again to retry.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [season, date, refresh]);
  const days = [...new Set([leagueToday(), date, ...dates])].sort();
  return (
    <section
      className="rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-6 text-slate-100"
      aria-labelledby="readiness-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="readiness-title" className="text-xl font-bold">
            Before games
          </h3>
          <p className="mt-1 text-sm text-slate-300">
            Check the schedule and player lists for the day.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRefresh((v) => v + 1)}
          className="rounded-lg bg-blue-700 px-4 py-2 font-bold disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check again"}
        </button>
      </div>
      <label className="my-4 block text-sm">
        Game day
        <select
          aria-label="Game day"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="ml-2 max-w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-white"
        >
          {days.map((day) => (
            <option key={day} value={day}>
              {day === leagueToday() ? "Today · " : ""}
              {displayScheduleDate(day)}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="text-amber-200">
          {error}
        </p>
      )}
      {data && (
        <>
          {!data.games.length ? (
            <p>No games on this day. Choose another game day above.</p>
          ) : (
            <>
              <p className="mb-4 font-bold" role="status">
                {gameDayOverview(data.games)}
              </p>
              <div className="space-y-3">
                {data.games.map((game) => {
                  const view = gameDayPresentation(game);
                  return (
                    <article
                      key={game.id}
                      aria-label={`${game.home} vs ${game.away}`}
                      className="rounded-xl border border-slate-700 bg-slate-950 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h4 className="font-bold">
                          {game.home} vs {game.away}
                        </h4>
                        <span
                          className={`inline-block rounded-lg px-2 py-1 text-xs font-bold ${toneClasses[view.tone]}`}
                        >
                          {view.label}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">
                        {displayBookingTime(game.startTime)}–
                        {displayBookingTime(game.endTime)} ·{" "}
                        {game.location.replace("The Dugout: ", "")}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {game.league}
                      </p>
                      <p
                        className={`mt-3 text-sm ${view.tone === "fix" ? "text-red-200" : view.tone === "review" ? "text-amber-200" : "text-slate-200"}`}
                      >
                        {view.message}
                      </p>
                      {view.screens.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {view.screens.map((screen) => (
                            <button
                              type="button"
                              key={screen}
                              onClick={() => onNavigate(screen)}
                              className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white"
                            >
                              {actionLabels[screen]}
                            </button>
                          ))}
                        </div>
                      )}
                      <details className="mt-3 border-t border-slate-800 pt-3">
                        <summary className="cursor-pointer text-sm text-slate-400">
                          See details
                        </summary>
                        {view.adminIssues.length > 0 && (
                          <ul className="mt-3 space-y-2 text-sm text-slate-300">
                            {[
                              ...new Set(
                                view.adminIssues.map((issue) => issue.message),
                              ),
                            ].map((message) => (
                              <li key={message}>{message}</li>
                            ))}
                          </ul>
                        )}
                        {!!game.checks.length && (
                          <ul className="mt-3 space-y-1 text-xs text-slate-400">
                            {game.checks.map((check) => (
                              <li key={check}>
                                ✓ {simpleReadinessCheck(check)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                    </article>
                  );
                })}
              </div>
            </>
          )}
          <p className="mt-4 text-xs text-slate-400">
            Last checked{" "}
            {new Date(data.checkedAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            · Season {season}.
          </p>
        </>
      )}
    </section>
  );
};
