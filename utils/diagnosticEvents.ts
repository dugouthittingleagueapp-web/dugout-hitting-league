export const diagnosticCatalog = {
  scoring_rejected: {
    severity: "warning",
    summary:
      "A scoring save was rejected. Review the game and the device recovery copy.",
    resolution: "unknown",
  },
  scoring_timeout: {
    severity: "warning",
    summary:
      "A scoring save could not be confirmed. The device recovery copy was retained.",
    resolution: "unresolved",
  },
  scoring_repeated_failure: {
    severity: "warning",
    summary:
      "Scoring has repeatedly failed to synchronize on a device. Its saved copy needs checking.",
    resolution: "unresolved",
  },
  scoring_conflict: {
    severity: "critical",
    summary:
      "A conflicting scoring copy needs review. Do not overwrite or re-enter the saved pitches.",
    resolution: "unresolved",
  },
  ownership_conflict: {
    severity: "warning",
    summary:
      "A scoring attempt did not have control of the game. Saved device scores may need review.",
    resolution: "unknown",
  },
  recovery_started: {
    severity: "information",
    summary: "A device started retrying its saved scoring copy.",
    resolution: "unknown",
  },
  recovery_completed: {
    severity: "information",
    summary:
      "A device confirmed that its saved scoring copy synchronized successfully.",
    resolution: "resolved",
  },
  recovery_failed: {
    severity: "warning",
    summary:
      "A device could not complete scoring recovery. Keep its saved copy for review.",
    resolution: "unresolved",
  },
  recovery_manual_review: {
    severity: "critical",
    summary: "A saved scoring copy was retained on a device for manual review.",
    resolution: "unresolved",
  },
  scoring_api_error: {
    severity: "warning",
    summary:
      "The scoring service could not finish a request. Check the device recovery copy.",
    resolution: "unknown",
  },
  database_error: {
    severity: "warning",
    summary:
      "A gameplay request could not reach the database. Check the device recovery copy.",
    resolution: "unknown",
  },
  finalization_failed: {
    severity: "warning",
    summary:
      "Game completion could not be confirmed. Reopen the game and review its saved status.",
    resolution: "unknown",
  },
  schedule_rejected: {
    severity: "warning",
    summary:
      "A schedule change was rejected. The requested changes were not applied.",
    resolution: "unknown",
  },
  schedule_failed: {
    severity: "warning",
    summary:
      "A schedule operation did not finish. Review the schedule before retrying.",
    resolution: "unknown",
  },
} as const;
export type DiagnosticType = keyof typeof diagnosticCatalog;
export type DiagnosticSeverity = "critical" | "warning" | "information";
export type DiagnosticResolution = "unresolved" | "resolved" | "unknown";
export type DiagnosticInput = {
  eventId: string;
  operationId: string;
  correlationId: string;
  type: DiagnosticType;
  gameId?: string;
};
export type DiagnosticEvent = {
  home_team?: string | null;
  away_team?: string | null;
  event_id: string;
  operation_id: string;
  correlation_id: string;
  event_type: DiagnosticType;
  severity: DiagnosticSeverity;
  resolution: DiagnosticResolution;
  summary: string;
  code: string;
  route: string;
  source: "server" | "device";
  game_id: string | null;
  league: string | null;
  season: string | null;
  created_at: string;
  last_seen_at: string;
  occurrences: number;
};
export const DEVICE_EVENTS: readonly DiagnosticType[] = [
  "scoring_timeout",
  "scoring_repeated_failure",
  "scoring_conflict",
  "recovery_started",
  "recovery_completed",
  "recovery_failed",
  "recovery_manual_review",
];
export const validDiagnosticId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
/** Ignore no arbitrary text: reject unknown fields instead of attempting regex redaction. */
export const validateDiagnosticInput = (
  body: unknown,
  device = true,
): DiagnosticInput => {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Invalid diagnostic event.");
  const b = body as Record<string, unknown>;
  if (
    Object.keys(b).some(
      (k) =>
        !["eventId", "operationId", "correlationId", "type", "gameId"].includes(
          k,
        ),
    ) ||
    !uuid(b.eventId) ||
    !uuid(b.operationId) ||
    !uuid(b.correlationId) ||
    typeof b.type !== "string" ||
    !Object.prototype.hasOwnProperty.call(diagnosticCatalog, b.type) ||
    (device && !DEVICE_EVENTS.includes(b.type as DiagnosticType)) ||
    (b.gameId !== undefined && !validDiagnosticId(b.gameId))
  )
    throw new Error("Invalid diagnostic event.");
  return b as unknown as DiagnosticInput;
};
