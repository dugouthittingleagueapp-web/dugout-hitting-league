import React, { useEffect, useState } from "react";
import {
  getAdminOperations,
  getScoringServiceHealth,
} from "../services/storageService";
import type { SystemStatusResult } from "../server/systemStatus";
export const AdminSystemStatus: React.FC<{
  season: string;
  onIssues: () => void;
}> = ({ season, onIssues }) => {
  const [status, setStatus] = useState<SystemStatusResult | null>(null);
  const [scoring, setScoring] = useState<"responding" | "error" | "unknown">(
    "unknown",
  );
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setStatus(null);
    setScoring("unknown");
    Promise.allSettled([
      getAdminOperations<SystemStatusResult>("system_status", season),
      getScoringServiceHealth(),
    ])
      .then(([monitor, score]) => {
        if (!active) return;
        if (monitor.status === "fulfilled") {
          setStatus(monitor.value);
          if (monitor.value.database === "available")
            setLastSuccess(monitor.value.checkedAt);
        }
        setScoring(
          score.status === "fulfilled" ? score.value.scoring : "unknown",
        );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [season, refresh]);
  const items = [
    [
      "Database Connection",
      status
        ? status.database === "available"
          ? "Available"
          : "Unavailable"
        : "Unable to verify",
      status?.database === "available",
    ],
    [
      "Scoring Service",
      scoring === "responding"
        ? "Responding"
        : scoring === "error"
          ? "Experiencing an error"
          : "Unable to verify",
      scoring === "responding",
    ],
    [
      "Game Synchronization",
      status?.synchronization === "no_known_problems"
        ? "No known synchronization problems reported"
        : status?.synchronization === "reported_problems"
          ? "One or more reported problems"
          : "Unable to determine",
      status?.synchronization === "no_known_problems",
    ],
    [
      "Recent Errors · 24 hours",
      status?.recentErrors === null || !status
        ? "Unable to verify"
        : status.recentErrors === 0
          ? "No recorded issues"
          : "Issues recorded — View Details",
      status?.recentErrors === 0,
    ],
  ] as const;
  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-6 text-slate-100">
      <div className="flex flex-wrap justify-between gap-3">
        <h3 className="text-xl font-bold">System Status</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRefresh((v) => v + 1)}
          className="rounded-lg bg-blue-700 px-4 py-2 font-bold disabled:opacity-50"
        >
          {busy ? "Checking…" : "Refresh status"}
        </button>
      </div>
      <dl className="my-4 grid gap-3 sm:grid-cols-2">
        {items.map(([label, value, good]) => (
          <div key={label} className="rounded-lg border border-slate-700 p-3">
            <dt className="text-sm text-slate-300">{label}</dt>
            <dd
              className={`mt-1 font-bold ${good ? "text-emerald-300" : "text-amber-200"}`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {!busy &&
        (!status ||
          status.database === "unavailable" ||
          scoring !== "responding" ||
          status.history === "unavailable") && (
          <p role="alert" className="mb-3 text-sm text-amber-200">
            Some checks could not be verified. Refresh before game time. Keep
            any scoring device with unsynced pitches open.
          </p>
        )}
      <p className="text-xs text-slate-400">
        {status
          ? `Last check: ${new Date(status.checkedAt).toLocaleString()}. `
          : ""}
        {lastSuccess
          ? `Last successful database check: ${new Date(lastSuccess).toLocaleString()}. `
          : ""}
        These checks cannot confirm every device has synchronized. No test
        scores are written.
      </p>
      <button
        type="button"
        onClick={onIssues}
        className="mt-3 font-bold text-blue-300 underline"
      >
        View diagnostics
      </button>
    </section>
  );
};
