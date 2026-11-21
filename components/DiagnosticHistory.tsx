import { leagueToday } from "../utils/leagueClock";
import React, { useEffect, useState } from "react";
import {
  getAdminOperations,
  cleanupDiagnosticHistory,
} from "../services/storageService";
import type { DiagnosticEvent } from "../utils/diagnosticEvents";
type Page = {
  events: DiagnosticEvent[];
  nextCursor: string | null;
  retentionDays: number;
  checkedAt: string;
};
export const DiagnosticHistory: React.FC<{
  season: string;
  onReviewGame: () => void;
}> = ({ season, onReviewGame }) => {
  const [from, setFrom] = useState(() =>
    leagueToday(new Date(Date.now() - 7 * 86400000)),
  );
  const [to, setTo] = useState(() => leagueToday());
  const [severity, setSeverity] = useState("");
  const [league, setLeague] = useState("");
  const [gameId, setGameId] = useState("");
  const [knownGames, setKnownGames] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    setPage(null);
    getAdminOperations<Page>("diagnostics", season, {
      from,
      to,
      severity,
      league,
      gameId,
      cursor,
    })
      .then((data) => {
        if (active) {
          setPage(data);
          setKnownGames((previous) => {
            const next = { ...previous };
            for (const event of data.events)
              if (event.game_id)
                next[event.game_id] =
                  event.home_team && event.away_team
                    ? `${event.home_team} vs ${event.away_team} (${event.season || "season unknown"})`
                    : `Game ${event.game_id.slice(-8)}`;
            return Object.fromEntries(Object.entries(next).slice(-200));
          });
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Diagnostic history could not load. Refresh to try again. This does not stop scoring.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [season, from, to, severity, league, gameId, cursor, refresh]);
  const filter = (setter: (s: string) => void, value: string) => {
    setCursor("");
    setter(value);
  };
  const exportReport = () => {
    if (!page) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            filters: { from, to, severity, league, gameId },
            ...page,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dugout-troubleshooting.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-6 text-slate-100">
      <h3 className="text-xl font-bold">Recent issues</h3>
      <p className="mt-1 text-sm text-slate-300">
        See reported saving problems and what happened afterward. Saved score
        copies stay on the phone that recorded them. Date filters use league time.
      </p>
      <div className="my-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["From", from, setFrom, "date"],
          ["Through", to, setTo, "date"],
          ["League", league, setLeague, "text"],
        ].map(([label, value, setter, type]) => (
          <label key={label as string} className="text-sm">
            {label as string}
            <input
              aria-label={`Diagnostics ${label}`}
              type={type as string}
              value={value as string}
              maxLength={100}
              onChange={(e) =>
                filter(setter as (s: string) => void, e.target.value)
              }
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
        ))}
        <label className="text-sm">
          Game
          <select
            aria-label="Diagnostic game"
            value={gameId}
            onChange={(e) => filter(setGameId, e.target.value)}
            className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
          >
            <option value="">All reported games</option>
            {Object.entries(knownGames).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Severity
          <select
            aria-label="Diagnostic severity"
            value={severity}
            onChange={(e) => filter(setSeverity, e.target.value)}
            className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="information">Information</option>
          </select>
        </label>
      </div>
      <div className="mb-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => setRefresh((v) => v + 1)}
          className="rounded-lg bg-blue-700 px-4 py-2 font-bold disabled:opacity-50"
        >
          {busy ? "Loading…" : "Refresh issues"}
        </button>
        <button
          type="button"
          disabled={!page}
          onClick={exportReport}
          className="rounded-lg border border-slate-600 px-4 py-2 disabled:opacity-50"
        >
          Download these results
        </button>
      </div>
      {error && (
        <p role="alert" className="text-amber-300">
          {error}
        </p>
      )}
      {page && (
        <>
          <p className="mb-3 text-xs text-slate-400">
            Up to 50 results per page. Retention: {page.retentionDays} days.
            Download each page for longer-term records.
          </p>
          {!page.events.length && (
            <p>
              No recorded issues in this period. Unreported device problems
              cannot be ruled out.
            </p>
          )}
          <div className="space-y-3">
            {page.events.map((event) => (
              <details
                key={event.event_id}
                className="rounded-lg border border-slate-700 p-3"
              >
                <summary className="cursor-pointer">
                  <span
                    className={
                      event.severity === "critical"
                        ? "text-red-300"
                        : event.severity === "warning"
                          ? "text-amber-200"
                          : "text-emerald-300"
                    }
                  >
                    {event.severity.toUpperCase()} · {event.resolution}
                  </span>
                  <p className="mt-1">{event.summary}</p>
                  {event.home_team && event.away_team && (
                    <p className="mt-1 text-sm">
                      {event.home_team} vs {event.away_team}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    {new Date(event.last_seen_at).toLocaleString()} ·{" "}
                    {event.league || "League unknown"} ·{" "}
                    {event.source === "device"
                      ? "Device reported"
                      : "Server observed"}
                    {event.occurrences > 1
                      ? ` · ${event.occurrences} reports`
                      : ""}
                  </p>
                </summary>
                <dl className="mt-3 break-all text-xs text-slate-300">
                  <dt>Game / Season</dt>
                  <dd>
                    {event.game_id || "Not available"} /{" "}
                    {event.season || "Unknown"}
                  </dd>
                  <dt>Operation / Code</dt>
                  <dd>
                    {event.route} / {event.code}
                  </dd>
                  <dt>Report / Correlation</dt>
                  <dd>
                    {event.event_id} / {event.correlation_id}
                  </dd>
                </dl>
                {event.resolution === "unresolved" && event.game_id && (
                  <>
                    <p className="mt-2 text-sm">
                      Open this game’s existing recovery controls on the device
                      holding the saved copy. Compare or download it before
                      making corrections.
                    </p>
                    <button
                      type="button"
                      onClick={onReviewGame}
                      className="mt-2 text-blue-300 underline"
                    >
                      Open league games
                    </button>
                  </>
                )}
              </details>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {cursor && (
              <button
                type="button"
                onClick={() => setCursor("")}
                className="text-blue-300 underline"
              >
                Newest results
              </button>
            )}
            {page.nextCursor && (
              <button
                type="button"
                onClick={() => setCursor(page.nextCursor!)}
                className="text-blue-300 underline"
              >
                Older results
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  `Remove up to 500 diagnostic records older than ${page.retentionDays} days? Export older history first. Games and scores are not changed.`,
                )
              )
                return;
              setBusy(true);
              try {
                await cleanupDiagnosticHistory();
                setCursor("");
                setRefresh((v) => v + 1);
              } catch {
                setError("History cleanup could not finish. Try again.");
              } finally {
                setBusy(false);
              }
            }}
            className="mt-5 text-sm text-slate-300 underline disabled:opacity-50"
          >
            Remove expired diagnostic history
          </button>
        </>
      )}
    </section>
  );
};
