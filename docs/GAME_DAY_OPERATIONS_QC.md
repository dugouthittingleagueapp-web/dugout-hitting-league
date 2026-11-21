# Game-Day Operations — implementation and QC handoff

## Implemented scope

Dedicated branch: `feature/game-day-operations`, based on the accepted Admin
Preview branch and containing Production's released Phase 2 baseline `778ef945`.
This is a stacked change over draft PR #11, not a replacement for the scoring
release. Older experimental atomic-sync branches were not merged.

- **Schedule prevention:** existing whole-season conflict editor, CSV validation,
  transactions, receipts, active-season locks and protected-game rules retained.
  Closed legacy `/api/matches` booking creation and snapshot-edit bypasses.
  Back-to-back bookings remain valid; overnight intervals remain explicitly
  rejected by the existing same-day rules. Ad-hoc games without a booking remain
  available. No hidden assumption about divisions, nightly capacity or slots.
- **Readiness:** Admin Dashboard shows today in league time, selectable scheduled
  dates, expandable game checks, Ready / Needs Attention / Blocked, manual refresh
  and links to existing Schedule, Rosters and league-game screens. Uses a
  consistent read-only snapshot of the active season. Missing weekly selections
  are advisory; no new three-regular-player rule or start restriction was added.
- **Diagnostics:** authenticated, persistent, bounded event history with league,
  date, severity and reported-game filters, pagination, per-page JSON export and
  explicit expired-history cleanup. Fixed summaries and safe codes replace raw
  errors. Device and server reports are distinguished. Recovery links lead to
  existing controls; there is no force merge or overwrite action.
- **Status:** independent authenticated database and scoring-route probes,
  diagnostic error counts, reported synchronization problems, check timestamps
  and manual refresh. The scoring probe checks required tables/columns without
  reading ownership tokens or writing pitches. A reachable route does not prove
  scoring writes or all devices are healthy. Failed/unavailable checks stay
  unavailable or unknown.

## Principal files

- `server/legacyScheduleGuard.ts`, `api/matches.ts`: legacy booking guards.
- `server/gameDayReadiness.ts`, `server/readinessEndpoint.ts`,
  `components/GameDayReadiness.tsx`: readiness assessment and UI.
- `server/diagnostics.ts`, `utils/diagnosticEvents.ts`,
  `services/diagnosticReporter.ts`, `components/DiagnosticHistory.tsx`:
  event validation, persistence, independent reporting and admin history.
- `server/systemStatus.ts`, `components/AdminSystemStatus.tsx`,
  `api/scoring.ts`: read-only health checks.
- `api/schedule-admin.ts`, `api/scoring-lock.ts`,
  `components/AdminDashboard.tsx`, `services/storageService.ts`: integration.
- `utils/leagueClock.ts`: league calendar dates and DST-aware diagnostic filters.
- `server/databaseConnection.ts`: exact endpoint pin for this Preview branch.
- `migrations/diagnostic-events.sql`: one additive table and indexes.
- `tests/operations/`, `tests/schedule/legacyScheduleGuard.test.ts` and guarded
  browser fixtures/workflows: regression coverage.

No scoring-journal format, pitch protocol, acknowledgement/revision logic,
player statistics, ownership tokens, pending recovery storage keys or score
history was migrated or rewritten. Scoring routes gained observational error
hooks; client recovery gained best-effort event reporting. Calendar changes via
legacy snapshots must now use Admin Schedule. This is the intentional behavior
change, separate from scoring commands.

## Database and cost controls

New table: `diagnostic_events`; no foreign-key cascades to game/player tables.
Event IDs, operation/correlation IDs, category, severity, resolution, fixed
summary/code, source, route and optional game/league/season context only.
No child names, pitch values, snapshots, raw request/error bodies or credentials.
Team matchup names in the viewer are joined from existing teams, not logged as
personal player details. Context sizes and returned rows are bounded.

- Zero diagnostic database writes for ordinary successful pitches.
- Errors/recovery transitions only. Separate pool, max one diagnostics connection
  per function instance, short timeouts, at most four deferred server reports.
- Device queue: at most 20 events in memory, 50 incident contexts, 12 report
  attempts per minute. It never reads/writes scoring recovery storage.
- Server: diagnostics-only transaction/try-lock and a global 60-event/update
  per-minute budget. Repeated operation/category records aggregate; retries of
  the original event ID do not insert another row.
- History pages: 50 records, cursor pagination, bounded date range. Checks run
  when opened/refreshed; no recurring dashboard polling.
- Retention: 90 days since last report by default. Optional
  `DIAGNOSTIC_RETENTION_DAYS` accepts 7–365, otherwise defaults to 90.
  Expired records are excluded from views/status. Admin cleanup removes at most
  500 expired diagnostic rows per click, after confirmation; it never touches
  games. Physical cleanup is explicit, not an installed cron. Export pages
  before expiry for longer retention.

At 100 distinct events per week, roughly 1,300 rows fall inside 90 days, normally
only a few MB including indexes. This is a planning estimate, not measured
Production traffic. Healthy scoring generates no routine-pitch log volume.

## Validation results

- **600 automated tests passed in 71 files**, including real disposable
  PostgreSQL integration tests; TypeScript and production build passed.
- Existing scoring regressions cover normal/rapid scoring, durable backups,
  hanging/lost responses, offline replay, stale revisions, concurrent users,
  ownership, undo/corrections, substitutes, two-player formats, forfeits,
  5/3/1-pitch extras, finalization, Fix Stats, fan restrictions and seasons.
- New tests cover readiness states, team/roster/lineup integrity, fewer regulars
  with substitutes, unconfirmed lineups, status mismatches, zero-valued pitches,
  cross-division conflicts, no games, archives and DST boundaries.
- Diagnostics tests cover authorization, unknown/secret/snapshot-field rejection,
  persistence, deduplication, correlated resolution, queue/rate limits,
  retention, unavailable logging, migration reapplication and unchanged games.
- Health tests cover normal response, database failure/timeout, unavailable
  monitoring, reported problems and unknown/unreported device state.
- Actual Chromium UI → real API → disposable PostgreSQL passed readiness,
  manual refresh, warning-only weekly lineups, independent service failure,
  monitoring outage, diagnostic report/recovery/filter/export, authorization,
  and mobile layout.
- Actual scoring browser regressions passed hanging requests + refresh, lost
  responses, blocked storage, stale profiles, duplicate tabs, all extra formats,
  mobile fifteenth pitch and finalization/conflict preservation. An initial
  scrolling timeout on the third extra round passed alone and on full rerun
  after finished test browser contexts were closed.
- Normal scoring/substitution/undo/forfeit/fan browser workflows passed while
  diagnostic requests were deliberately aborted.
- Existing conflict-editor browser workflows passed chained overlaps, atomic
  multi-game changes, duplicate-free lost-response retry, cancellation,
  protected games, cross-filter checks, stale concurrent saves and mobile CSV.

Fault-injection runs can print Playwright cancellation traces for intentionally
aborted requests; successful assertions and process exits are recorded separately.
A Chromium mobile viewport is not physical Android Firefox certification.

## Isolated Preview and test data

Neon project `young-mountain-13687992`, new child branch
`br-ancient-lab-a4v8c7jv`, endpoint
`ep-holy-term-a4520vi1.us-east-1.aws.neon.tech`.
Parent is the Admin Preview branch, never Production.

The additive migration preserved fingerprints of all 185 copied games and 67
copied teams. Added only four synthetic games and five synthetic teams under
**Game-Day QC**, active season **2027**, date **December 31, 2027**:

1. QC Eagles vs QC Panthers: Ready, 1–2 PM, Tunnels 5/6.
2. QC Wolves vs QC Raptors: unconfirmed lineup, 1–2 PM, Tunnels 7/8.
3. QC Roster Review vs QC Eagles: empty roster needing review, 2–3 PM, Tunnels 5/6.
4. QC Wolves vs QC Raptors: deliberate overlap, 1:30–2:30 PM, Tunnels 7/8.

Original copied game/team fingerprints were unchanged after fixture creation.
Existing Admin Preview and Production databases were not modified. Never migrate
these synthetic records, Preview credentials or test environment settings into
Production.

## Preview acceptance procedure

Use the dedicated deployment URL in the release handoff and your normal admin
login. Protected Vercel login may be required.

1. Open Admin Dashboard. Confirm today's no-game state where appropriate, then
   choose December 31, 2027 in Game-Day Readiness.
2. Expand each QC game. Confirm Ready, lineup reminder, roster review and overlap
   explanations. A three-player attendance requirement must not appear.
3. Follow Open Schedule from the overlap. Filter to Game-Day QC. Move the
   1:30 PM game to a clear later time; save once. Return to Dashboard and reselect
   the date: the overlap should be gone. Cancel a separate edit and confirm it
   did not save. Review the roster through the existing Rosters tab.
4. Refresh System Status. Check that database/scoring responses are separate
   from reported synchronization state. Open Diagnostics, filter, expand and
   download results. Empty history must not claim every device synchronized.
5. In an eligible synthetic game, test a saved pitch, interruption, reconnection
   and existing Retry controls on the same device. Return to Diagnostics to see
   reports/recovery, preserving any conflicting copy for the existing review
   workflow. Do not use live games for this test.
6. Check mobile browser scrolling/readability on the actual devices in use.

## Limits and remaining risks

- Diagnostics are best effort. If the database/service is down or a rate/queue
  limit is reached, some events can be absent. Unsent memory-only reports may be
  lost on refresh/close. The durable scoring journal is independent and retained.
- Incident correlation in memory can restart after refresh; an earlier report
  can remain unresolved even when a later recovery report for the same game
  succeeds. Review the game timeline and the original device; no cross-device
  conflicts are automatically marked resolved.
- Server rejections have unknown recovery disposition unless a device reports
  its outcome. The history does not retroactively reconstruct expired platform
  logs or certify devices that never reported.
- Health probes are read-only and do not test actual scoring writes, every
  network path or umpire devices. Monitoring is not a substitute for game checks.
- Authenticated cloud UI acceptance, physical mobile browsers, large system-font
  settings and real poor-Wi-Fi conditions need owner testing. Local end-to-end
  tests do not claim those protected cloud interactions were exercised.
- Existing external font/Tailwind CDN dependencies and the app's bundle size
  remain outside this scope. No broad refactoring was performed.

## Recommended Production release plan — explicit approval required

1. Complete owner Preview acceptance and review this stacked change together
   with PR #11. Reconfirm live SHA and all released scoring changes are present.
2. Follow `ADMIN_PRODUCTION_READINESS.md` for its separate additive player-
   identity prerequisite, including a fresh snapshot/restore point, reviewed
   mapping and stale-snapshot guard. Do not reuse old assumptions if live rosters
   have legitimately changed.
3. Apply only reviewed additive SQL to the verified Production branch after
   explicit approval. Diagnostics DDL is separate and was rehearsed in isolated
   local/Neon databases. Verify existing game/roster fingerprints and schema.
4. Build the reviewed source using existing Production-scoped credentials;
   never promote a deployment carrying Preview database/session settings.
5. Verify authenticated read-only admin pages, fan pages, scheduled games,
   existing statistics, service probes and authorization. Synthetic mutations
   belong in Preview. Monitor reported errors around the first game night.
6. Roll back application code if necessary, retaining additive tables/history.
   Do not drop identity or diagnostics tables or restore old scores as an app
   rollback. No Production migration, deployment, merge or writes are authorized
   by this handoff.
