import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
vi.mock("../../api/db.js", async () => {
  const { Pool } = await import("pg");
  const url =
    process.env.DUGOUT_TEST_DATABASE_URL ||
    "postgres://unused@127.0.0.1:65432/dugout_test_unused";
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    !parsed.pathname.startsWith("/dugout_test_")
  )
    throw Error("Disposable local database required");
  const schema = `operations_${process.pid}_${Date.now()}`;
  return {
    default: Object.assign(
      new Pool({ connectionString: url, options: `-c search_path=${schema}` }),
      { testSchema: schema },
    ),
  };
});
import pool from "../../api/db";
import {
  diagnosticPool,
  recordDiagnostic,
  readDiagnostics,
  cleanupDiagnostics,
} from "../../server/diagnostics";
import schedule from "../../api/schedule-admin";
import scoring from "../../api/scoring";
import { signSessionToken } from "../../api/auth";
const call = async (
  handler: any,
  role: "admin" | "umpire" | null,
  method: string,
  body: any = {},
  query: any = {},
) => {
  const res: any = { statusCode: 200, setHeader: vi.fn() };
  res.status = (n: number) => {
    res.statusCode = n;
    return res;
  };
  res.json = (b: any) => {
    res.body = b;
    return res;
  };
  await handler(
    {
      method,
      body,
      query,
      headers: role
        ? { authorization: `Bearer ${signSessionToken(role)}` }
        : {},
    } as any,
    res,
  );
  return res;
};
const event = (type = "recovery_failed", operationId = randomUUID()) =>
  ({
    eventId: randomUUID(),
    operationId,
    correlationId: operationId,
    type,
    gameId: "synthetic",
  }) as any;
describe.skipIf(!process.env.DUGOUT_TEST_DATABASE_URL)(
  "Operations on disposable PostgreSQL",
  () => {
    beforeAll(async () => {
      vi.stubEnv("SESSION_SECRET", "isolated-operations-only-session-secret");
      await pool.query(`CREATE SCHEMA ${(pool as any).testSchema}`);
      await pool.query(
        readFileSync(new URL("../../schema.sql", import.meta.url), "utf8"),
      );
      await pool.query(
        readFileSync(
          new URL("../../migrations/diagnostic-events.sql", import.meta.url),
          "utf8",
        ),
      );
      await pool.query(`ALTER TABLE matches ADD COLUMN revision BIGINT NOT NULL DEFAULT 0;
        CREATE TABLE scoring_locks(match_id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,updated_at TIMESTAMPTZ DEFAULT NOW());`);
      await pool.query(
        "INSERT INTO app_settings VALUES ('current_season','2027'); INSERT INTO leagues(id,season) VALUES ('QC','2027'); INSERT INTO matches(id,league,season,date,innings) VALUES ('synthetic','QC','2027','2027-11-01','[]');",
      );
    });
    afterAll(async () => {
      await diagnosticPool.end();
      await pool.end();
      vi.unstubAllEnvs();
    });
    it("applies the additive migration twice without changing game fingerprints", async () => {
      const before = (
        await pool.query(
          "SELECT md5(row_to_json(m)::text) AS hash FROM matches m",
        )
      ).rows;
      await pool.query(
        readFileSync(
          new URL("../../migrations/diagnostic-events.sql", import.meta.url),
          "utf8",
        ),
      );
      expect(
        (
          await pool.query(
            "SELECT md5(row_to_json(m)::text) AS hash FROM matches m",
          )
        ).rows,
      ).toEqual(before);
    });
    it("persists bounded safe context, deduplicates IDs and marks same-device recovery resolved", async () => {
      const e = event();
      expect(await recordDiagnostic(e, "device", "/api/scoring", pool)).toBe(
        true,
      );
      expect(await recordDiagnostic(e, "device", "/api/scoring", pool)).toBe(
        true,
      );
      let rows = (
        await pool.query(
          "SELECT * FROM diagnostic_events WHERE operation_id=$1",
          [e.operationId],
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        occurrences: 1,
        league: "QC",
        season: "2027",
        resolution: "unresolved",
      });
      expect(
        await recordDiagnostic(
          event("recovery_completed", e.operationId),
          "device",
          "/api/scoring",
          pool,
        ),
      ).toBe(true);
      rows = (
        await pool.query(
          "SELECT resolution FROM diagnostic_events WHERE operation_id=$1",
          [e.operationId],
        )
      ).rows;
      expect(rows.every((r) => r.resolution === "resolved")).toBe(true);
    });
    it("bounds repeated error writes using the diagnostics-only budget", async () => {
      const e = event();
      for (let i = 0; i < 65; i++)
        await recordDiagnostic(
          { ...e, eventId: randomUUID() },
          "device",
          "/api/scoring",
          pool,
        );
      expect(
        (
          await pool.query(
            "SELECT occurrences FROM diagnostic_events WHERE operation_id=$1",
            [e.operationId],
          )
        ).rows[0].occurrences,
      ).toBeLessThanOrEqual(60);
    });
    it("supports filtered bounded history and only deletes expired diagnostics", async () => {
      await pool.query(
        "UPDATE diagnostic_events SET last_seen_at=NOW()-INTERVAL '100 days'",
      );
      expect((await readDiagnostics({}, pool)).events).toHaveLength(0);
      expect((await cleanupDiagnostics(pool)).removed).toBeGreaterThan(0);
      expect(
        (await pool.query("SELECT COUNT(*)::int AS n FROM matches")).rows[0].n,
      ).toBe(1);
      await recordDiagnostic(event(), "device", "/api/scoring", pool);
      expect(
        (
          await readDiagnostics(
            { gameId: "synthetic", severity: "warning" },
            pool,
          )
        ).events.length,
      ).toBe(1);
    });
    it("authorizes reports separately from admin history and health", async () => {
      for (const role of [null, "umpire"] as const) {
        expect(
          (await call(schedule, role, "GET", {}, { action: "diagnostics" }))
            .statusCode,
        ).toBe(role ? 403 : 401);
        expect(
          (await call(schedule, role, "GET", {}, { action: "system_status" }))
            .statusCode,
        ).toBe(role ? 403 : 401);
        expect(
          (await call(scoring, role, "GET", {}, { action: "health" }))
            .statusCode,
        ).toBe(role ? 403 : 401);
      }
      expect(
        (
          await call(schedule, "umpire", "POST", {
            action: "report_diagnostic",
            event: event(),
          })
        ).statusCode,
      ).toBe(202);
      expect(
        (await call(schedule, "admin", "GET", {}, { action: "diagnostics" }))
          .statusCode,
      ).toBe(200);
      const health = await call(
        scoring,
        "admin",
        "GET",
        {},
        { action: "health" },
      );
      expect(health.statusCode).toBe(200);
      expect(health.body.scoring).toBe("responding");
    });
    it("rejects secret-bearing reports without writing diagnostic data", async () => {
      const before = (
        await pool.query("SELECT COUNT(*)::int AS count FROM diagnostic_events")
      ).rows;
      const r = await call(schedule, "umpire", "POST", {
        action: "report_diagnostic",
        event: { ...event(), password: "never-store-this" },
      });
      expect(r.statusCode).toBe(400);
      expect(
        (
          await pool.query(
            "SELECT COUNT(*)::int AS count FROM diagnostic_events",
          )
        ).rows,
      ).toEqual(before);
    });
    it("readiness uses a read-only snapshot and rejects archived selection", async () => {
      const before = (
        await pool.query(
          "SELECT md5(row_to_json(m)::text) AS hash FROM matches m",
        )
      ).rows;
      const r = await call(
        schedule,
        "admin",
        "GET",
        {},
        { action: "readiness", season: "2027", date: "2027-11-01" },
      );
      expect(r.statusCode).toBe(200);
      expect(r.body.games[0].state).toBe("blocked");
      expect(
        (
          await call(
            schedule,
            "admin",
            "GET",
            {},
            { action: "readiness", season: "2025" },
          )
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await pool.query(
            "SELECT md5(row_to_json(m)::text) AS hash FROM matches m",
          )
        ).rows,
      ).toEqual(before);
    });
  },
);
