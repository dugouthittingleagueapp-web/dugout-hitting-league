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
      "Saved game data",
      status
        ? status.database === "available"
          ? "Connection working"
          : "Connection problem"
        : "Couldn’t check",
      status?.database === "available",
    ],
    [
      "Scoring connection",
      scoring === "responding"
        ? "Connection working"
        : scoring === "error"
          ? "Connection problem"
          : "Couldn’t check",
      scoring === "responding",
    ],
    [
      "Reported save problems",
      status?.synchronization === "no_known_problems"
        ? "No problems reported"
        : status?.synchronization === "reported_problems"
          ? "Saved scores need review"
          : "Couldn’t check reports",
      status?.synchronization === "no_known_problems",
    ],
    [
      "Issues in the last 24 hours",
      status?.recentErrors === null || !status
        ? "Couldn’t check"
        : status.recentErrors === 0
          ? "None recorded"
          : "Issues recorded — see recent issues",
      status?.recentErrors === 0,
    ],
  ] as const;
  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-6 text-slate-100">
      <div className="flex flex-wrap justify-between gap-3">
        <h3 className="text-xl font-bold">App connection</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRefresh((v) => v + 1)}
          className="rounded-lg bg-blue-700 px-4 py-2 font-bold disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check connection"}
        </button>
      </div>
      <dl className="my-4 divide-y divide-slate-700">
        {items.map(([label, value, good]) => (
          <div
            key={label}
            className="flex flex-wrap justify-between gap-2 py-3"
          >
            <dt className="text-sm text-slate-300">{label}</dt>
            <dd
              className={`font-bold ${busy ? "text-slate-300" : good ? "text-emerald-300" : "text-amber-200"}`}
            >
              {busy ? "Checking…" : value}
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
            We couldn’t confirm everything is working. Check again. Keep any
            phone with scores waiting to send open.
          </p>
        )}
      <p className="text-xs text-slate-400">
        {status
          ? `Checked ${new Date(status.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. `
          : ""}
        {status?.database !== "available" && lastSuccess
          ? `Last working data connection: ${new Date(lastSuccess).toLocaleString()}. `
          : ""}
        A phone can still have scores waiting to send, even when no problems
        have been reported. Check that phone’s saved-scores message.
      </p>
      <button
        type="button"
        onClick={onIssues}
        className="mt-3 font-bold text-blue-300 underline"
      >
        See recent issues
      </button>
    </section>
  );
};
