import { describe, it, expect, vi } from "vitest";
import { systemStatus } from "../../server/systemStatus";
const healthy = () => ({
  query: vi.fn().mockResolvedValue({ rows: [{ available: 1 }] }),
});
const history = (unresolved = 0, recent = 0) => ({
  query: vi.fn().mockResolvedValue({ rows: [{ unresolved, recent }] }),
});
describe("Honest system health checks", () => {
  it("uses read-only checks and does not claim every device is synchronized", async () => {
    const db = healthy(),
      diag = history();
    const r = await systemStatus(db as any, diag as any);
    expect(r.database).toBe("available");
    expect(r.synchronization).toBe("no_known_problems");
    expect(r.scope).toContain("Unreported devices");
    expect(db.query.mock.calls[0][0].text).toBe("SELECT 1 AS available");
  });
  it("reports database failures and query timeouts without claiming success", async () => {
    const db = { query: vi.fn().mockRejectedValue(Error("timeout")) };
    const r = await systemStatus(db as any, history() as any);
    expect(r.database).toBe("unavailable");
  });
  it("keeps unavailable monitoring unknown independently of database health", async () => {
    const r = await systemStatus(
      healthy() as any,
      { query: vi.fn().mockRejectedValue(Error("missing table")) } as any,
    );
    expect(r.database).toBe("available");
    expect(r.synchronization).toBe("unknown");
    expect(r.recentErrors).toBeNull();
  });
  it("reports unresolved device problems and recent errors independently", async () => {
    const r = await systemStatus(healthy() as any, history(2, 3) as any);
    expect(r.synchronization).toBe("reported_problems");
    expect(r.recentErrors).toBe(3);
  });
});
