import { leagueDayBoundary } from "../utils/leagueClock.js";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import pool from "../api/db.js";
import { getAuthFromRequest } from "../api/auth.js";
import {
  diagnosticCatalog,
  validateDiagnosticInput,
  validDiagnosticId,
  type DiagnosticInput,
  type DiagnosticType,
} from "../utils/diagnosticEvents.js";

// Separate, single-connection budget. Diagnostics cannot queue behind scoring's pool.
export const diagnosticPool = new pg.Pool({
  ...pool.options,
  max: 1,
  connectionTimeoutMillis: 700,
  query_timeout: 1000,
  statement_timeout: 750,
  idleTimeoutMillis: 10000,
});
diagnosticPool.on("error", () => {});
export const retentionDays = (): number => {
  const days = Number(process.env.DIAGNOSTIC_RETENTION_DAYS || 90);
  return Number.isInteger(days) && days >= 7 && days <= 365 ? days : 90;
};
export const recordDiagnostic = async (
  input: DiagnosticInput,
  source: "device" | "server",
  route: string,
  db: Pick<pg.Pool, "connect"> = diagnosticPool,
): Promise<boolean> => {
  let client: pg.PoolClient | undefined;
  try {
    const event = validateDiagnosticInput(input, source === "device");
    const spec = diagnosticCatalog[event.type];
    client = await db.connect();
    await client.query("BEGIN");
    // Bounded global budget, serialized in a diagnostics-only transaction.
    const lock = await client.query(
      "SELECT pg_try_advisory_xact_lock(676868,2) AS acquired",
    );
    if (!lock.rows[0]?.acquired) {
      await client.query("ROLLBACK");
      return false;
    }
    const prior = await client.query(
      "SELECT event_id FROM diagnostic_events WHERE event_id=$1",
      [event.eventId],
    );
    if (prior.rows.length) {
      await client.query("COMMIT");
      return true;
    }
    const budget = await client.query(
      "SELECT COALESCE(SUM(occurrences),0)::int AS count FROM diagnostic_events WHERE last_seen_at>NOW()-INTERVAL '1 minute'",
    );
    if (budget.rows[0]?.count >= 60) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      `INSERT INTO diagnostic_events
   (event_id,operation_id,correlation_id,event_type,severity,resolution,summary,code,route,source,game_id,league,season)
   SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,m.league,m.season FROM (SELECT 1) seed
   LEFT JOIN matches m ON m.id::text=$11
   ON CONFLICT (operation_id,event_type,source) DO UPDATE SET last_seen_at=NOW(),occurrences=LEAST(1000000,diagnostic_events.occurrences+1)`,
      [
        event.eventId,
        event.operationId,
        event.correlationId,
        event.type,
        spec.severity,
        spec.resolution,
        spec.summary,
        event.type.toUpperCase(),
        route,
        source,
        event.gameId || null,
      ],
    );
    if (source === "device" && event.type === "recovery_completed")
      await client.query(
        "UPDATE diagnostic_events SET resolution='resolved' WHERE operation_id=$1 AND source='device' AND resolution='unresolved'",
        [event.operationId],
      );
    await client.query("COMMIT");
    return true;
  } catch {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return false;
  } finally {
    client?.release();
  }
};

/** Schedules bounded work after the response; never await it on scoring's path. */
let deferredCount = 0;
export const deferDiagnostic = (
  input: DiagnosticInput,
  route: string,
): void => {
  if (deferredCount >= 4) return;
  deferredCount++;
  try {
    waitUntil(
      recordDiagnostic(input, "server", route)
        .catch(() => false)
        .finally(() => {
          deferredCount--;
        }),
    );
  } catch {
    deferredCount = Math.max(0, deferredCount - 1);
  }
};

/** Observe rejected authenticated mutations without retaining request bodies/errors. */
export const captureMutationDiagnostics = (
  req: any,
  res: any,
  route:
    | "/api/matches"
    | "/api/scoring"
    | "/api/scoring-lock"
    | "/api/schedule-admin",
): void => {
  if (
    !["POST", "PUT", "PATCH"].includes(req.method || "") ||
    res.__diagnosticCapture
  )
    return;
  const auth = getAuthFromRequest(req);
  if (!auth.authenticated || !["admin", "umpire"].includes(auth.role)) return;
  res.__diagnosticCapture = true;
  const json = res.json.bind(res);
  res.json = (body: any) => {
    try {
      const status = res.statusCode;
      const ownership =
        route === "/api/scoring-lock" &&
        body?.owned === false &&
        req.body?.action !== "status" &&
        req.body?.action !== "release";
      if (status >= 400 || ownership) {
        let type: DiagnosticType =
          ownership || status === 423
            ? "ownership_conflict"
            : status >= 500
              ? "scoring_api_error"
              : "scoring_rejected";
        if (route === "/api/schedule-admin")
          type = status >= 500 ? "schedule_failed" : "schedule_rejected";
        else if (req.body?.isComplete === true) type = "finalization_failed";
        const operation =
          typeof req.body?.writeId === "string" &&
          /^[0-9a-f-]{36}$/i.test(req.body.writeId)
            ? req.body.writeId
            : randomUUID();
        const id = req.body?.id || req.body?.matchId;
        deferDiagnostic(
          {
            eventId: randomUUID(),
            operationId: operation,
            correlationId: operation,
            type,
            ...(validDiagnosticId(id) ? { gameId: id } : {}),
          },
          route,
        );
      }
    } catch {
      /* Never modify the original response. */
    }
    return json(body);
  };
};

export const readDiagnostics = async (
  query: Record<string, unknown>,
  db: Pick<pg.Pool, "query"> = diagnosticPool,
) => {
  const days = retentionDays();
  const end =
    typeof query.to === "string"
      ? leagueDayBoundary(query.to, true)
      : new Date();
  const start =
    typeof query.from === "string"
      ? leagueDayBoundary(query.from)
      : new Date(Date.now() - 7 * 86400000);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start > end ||
    end.getTime() - start.getTime() > 366 * 86400000
  )
    throw new Error("Choose a valid date range of up to one year.");
  const values: unknown[] = [start.toISOString(), end.toISOString(), days];
  let where =
    "last_seen_at >= $1 AND last_seen_at <= $2 AND last_seen_at >= NOW()-($3::int*INTERVAL '1 day')";
  for (const [param, column, allowed] of [
    ["severity", "severity", ["critical", "warning", "information"]],
    ["gameId", "game_id", null],
    ["league", "league", null],
  ] as const) {
    const value = query[param];
    if (value === undefined || value === "") continue;
    if (
      typeof value !== "string" ||
      value.length > 100 ||
      (allowed && !(allowed as readonly string[]).includes(value))
    )
      throw new Error("Choose valid diagnostic filters.");
    values.push(value);
    where += ` AND ${column}=$${values.length}`;
  }
  if (query.cursor !== undefined && query.cursor !== "") {
    const cursor = String(query.cursor).split("|");
    if (
      cursor.length !== 2 ||
      !Number.isFinite(Date.parse(cursor[0])) ||
      !/^[0-9a-f-]{36}$/.test(cursor[1])
    )
      throw new Error("Refresh the diagnostic history.");
    values.push(cursor[0], cursor[1]);
    where += ` AND (last_seen_at,event_id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`;
  }
  const result = await db.query(
    `SELECT history.*,home.name AS home_team,away.name AS away_team
     FROM (SELECT * FROM diagnostic_events WHERE ${where} ORDER BY last_seen_at DESC,event_id DESC LIMIT 51) history
     LEFT JOIN matches game ON game.id::text=history.game_id
     LEFT JOIN teams home ON home.id=game.home_team_id
     LEFT JOIN teams away ON away.id=game.away_team_id
     ORDER BY history.last_seen_at DESC,history.event_id DESC`,
    values,
  );
  const events = result.rows.slice(0, 50);
  const last = events[events.length - 1];
  return {
    events,
    nextCursor:
      result.rows.length > 50
        ? `${new Date(last.last_seen_at).toISOString()}|${last.event_id}`
        : null,
    retentionDays: days,
    checkedAt: new Date().toISOString(),
  };
};
export const cleanupDiagnostics = async (
  db: Pick<pg.Pool, "query"> = diagnosticPool,
) => {
  const result = await db.query(
    "DELETE FROM diagnostic_events WHERE event_id IN (SELECT event_id FROM diagnostic_events WHERE last_seen_at < NOW()-($1::int*INTERVAL '1 day') ORDER BY last_seen_at LIMIT 500) RETURNING event_id",
    [retentionDays()],
  );
  return { removed: result.rows.length, retentionDays: retentionDays() };
};
