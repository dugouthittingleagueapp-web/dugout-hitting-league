import pool from "../api/db.js";
import { diagnosticPool, retentionDays } from "./diagnostics.js";
export type SystemStatusResult = {
  checkedAt: string;
  database: "available" | "unavailable";
  synchronization: "reported_problems" | "no_known_problems" | "unknown";
  recentErrors: number | null;
  history: "available" | "unavailable";
  scope: string;
};
export const systemStatus = async (
  db = pool,
  diagnostics = diagnosticPool,
): Promise<SystemStatusResult> => {
  const databaseProbe = { text: "SELECT 1 AS available", query_timeout: 2000 };
  const [database, history] = await Promise.allSettled([
    db.query(databaseProbe),
    diagnostics.query(
      `SELECT COUNT(*) FILTER (WHERE severity IN ('critical','warning') AND last_seen_at>NOW()-INTERVAL '24 hours')::int AS recent,
    COUNT(*) FILTER (WHERE source='device' AND resolution='unresolved')::int AS unresolved
    FROM diagnostic_events WHERE last_seen_at>=NOW()-($1::int*INTERVAL '1 day')`,
      [retentionDays()],
    ),
  ]);
  const counts = history.status === "fulfilled" ? history.value.rows[0] : null;
  return {
    checkedAt: new Date().toISOString(),
    database: database.status === "fulfilled" ? "available" : "unavailable",
    synchronization: counts
      ? counts.unresolved > 0
        ? "reported_problems"
        : "no_known_problems"
      : "unknown",
    recentErrors: counts ? Number(counts.recent) : null,
    history: counts ? "available" : "unavailable",
    scope:
      "Read-only service checks. Unreported devices and complete score synchronization cannot be verified here.",
  };
};
