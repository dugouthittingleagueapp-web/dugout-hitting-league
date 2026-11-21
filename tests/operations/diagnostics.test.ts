import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  validateDiagnosticInput,
  diagnosticCatalog,
} from "../../utils/diagnosticEvents";
import { createDiagnosticReporter } from "../../services/diagnosticReporter";
import {
  recordDiagnostic,
  retentionDays,
  cleanupDiagnostics,
  captureMutationDiagnostics,
} from "../../server/diagnostics";
import { signSessionToken } from "../../api/auth";
const event = () => ({
  eventId: randomUUID(),
  operationId: randomUUID(),
  correlationId: randomUUID(),
  type: "recovery_failed" as const,
  gameId: "synthetic-game",
});
afterEach(() => {
  vi.unstubAllEnvs();
});
describe("Safe diagnostic boundaries", () => {
  it("rejects raw messages, snapshots, secrets and unsupported client events", () => {
    for (const extra of [
      { message: "password=secret" },
      { authorization: "Bearer x" },
      { innings: [] },
      { metadata: { token: "secret" } },
      { type: "database_error" },
    ])
      expect(() => validateDiagnosticInput({ ...event(), ...extra })).toThrow();
    expect(validateDiagnosticInput(event()).type).toBe("recovery_failed");
    expect(diagnosticCatalog.recovery_completed.resolution).toBe("resolved");
  });
  it("fails closed on malformed IDs and prototype keys", () => {
    for (const extra of [
      { type: "toString" },
      { gameId: "a".repeat(101) },
      { operationId: "bad" },
      { eventId: "secret token" },
    ])
      expect(() => validateDiagnosticInput({ ...event(), ...extra })).toThrow();
  });
  it("never propagates failed logging into the caller", async () => {
    await expect(
      recordDiagnostic(event(), "device", "/api/scoring", {
        connect: vi.fn().mockRejectedValue(new Error("db password=secret")),
      } as any),
    ).resolves.toBe(false);
  });
  it("bounds retention configuration and cleanup batch", async () => {
    vi.stubEnv("DIAGNOSTIC_RETENTION_DAYS", "0");
    expect(retentionDays()).toBe(90);
    vi.stubEnv("DIAGNOSTIC_RETENTION_DAYS", "120");
    expect(retentionDays()).toBe(120);
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await cleanupDiagnostics({ query } as any);
    expect(query.mock.calls[0][0]).toContain("LIMIT 500");
    expect(query.mock.calls[0][1]).toEqual([120]);
  });
  it("captures only authenticated mutations and leaves successful responses untouched", () => {
    const json = vi.fn();
    const res = { json, statusCode: 200 };
    const req = { method: "POST", headers: {}, body: {} };
    captureMutationDiagnostics(req, res, "/api/scoring");
    expect(res.json).toBe(json);
    vi.stubEnv("SESSION_SECRET", "operations-unit-test-only-secret");
    captureMutationDiagnostics(
      {
        ...req,
        headers: { authorization: `Bearer ${signSessionToken("umpire")}` },
      },
      res,
      "/api/scoring",
    );
    res.json({ saved: true });
    expect(json).toHaveBeenCalledWith({ saved: true });
  });
});
describe("Nonblocking device reports", () => {
  it("does not duplicate completion when journal and retry both confirm it", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = createDiagnosticReporter(send, randomUUID);
    reporter.report("game", "recovery_started");
    reporter.report("game", "recovery_completed");
    reporter.report("game", "recovery_completed");
    await new Promise((r) => setTimeout(r, 0));
    expect(send.mock.calls.map((c) => c[0].type)).toEqual([
      "recovery_started",
      "recovery_completed",
    ]);
  });

  it("records interruption, manual review and correlated recovery success without storage", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = createDiagnosticReporter(send, randomUUID);
    reporter.scoringState("game", "offline");
    reporter.scoringState("game", "attention");
    reporter.scoringState("game", "saved");
    await new Promise((r) => setTimeout(r, 0));
    expect(send.mock.calls.map((c) => c[0].type)).toEqual([
      "scoring_timeout",
      "recovery_manual_review",
      "recovery_completed",
    ]);
    expect(new Set(send.mock.calls.map((c) => c[0].operationId)).size).toBe(1);
  });
  it("bounds queue and attempts even during failures; scoring callbacks remain synchronous", async () => {
    const send = vi.fn().mockRejectedValue(new Error("offline"));
    const reporter = createDiagnosticReporter(send, randomUUID);
    for (let i = 0; i < 100; i++)
      expect(() =>
        reporter.scoringState("game" + i, "attention"),
      ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(reporter.pendingCount()).toBeLessThanOrEqual(20);
    expect(send.mock.calls.length).toBeLessThanOrEqual(12);
  });
  it("deduplicates repeated transitions and tolerates broken UUID/report services", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = createDiagnosticReporter(send, randomUUID);
    for (let i = 0; i < 30; i++) reporter.scoringState("game", "attention");
    await new Promise((r) => setTimeout(r, 0));
    expect(send).toHaveBeenCalledTimes(1);
    expect(() =>
      createDiagnosticReporter(send, () => {
        throw Error("blocked");
      }).report("game", "recovery_failed"),
    ).not.toThrow();
  });
});
