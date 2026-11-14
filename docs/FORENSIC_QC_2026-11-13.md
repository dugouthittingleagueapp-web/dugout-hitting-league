# Dugout Hitting League — forensic QC, Nov 13, 2026
**Review branch:** `review/forensic-qc-nov13` (from released Production commit `c6fa6532c0813b8e89168641aced4d9870a3b450`).
**Data isolation:** Neon `br-late-voice-a4kr7gyv`, a separate clone of Production. Never merge, deploy, or run tests against Production without separate approval.

## Scope and method
- Enumerated all 154 tracked repository files, including the code, test suites, local/archived datasets, build configuration, migration/repair scripts, and bundled assets.
- Static source-pattern scan covering 71 non-test TS/TSX/config files; manually inspected high-risk authentication, data access, scoring locks, offline sync, team/league management, AI roster import, schedule import, and key UI surfaces.
- The original 45 Vitest files/262 tests passed on the live release. This review adds independent regression tests. CI and Preview checks are release gates, not substitutes for device/browser interactions.
- No penetration test, large-scale load test, secret inspection, or full 154-file line-by-line correctness proof is claimed.

## Findings — prioritized

### P1 — data safety and abuse prevention
1. **AI roster import previously accepted unauthenticated POST requests** (`api/parse-roster.ts`). This could spend the configured Gemini API budget and process names/photos without a session. **Fixed on QC branch:** admin-only route plus request type, MIME, and payload size checks, with security tests. Production unchanged.
2. **Unknown Vercel Preview branches could be pointed at Production's Neon endpoint** (`server/databaseConnection.ts`). Earlier code validated only named review branches. **Fixed on QC branch:** explicit QC branch allowlist with its dedicated Neon endpoint, reject unknown Preview branches, add tests. Production unchanged.
3. **Schedule import is not transactional** (`services/storageService.ts#importScheduleFromCsv`). League/team/match creation happens in a per-game loop with individual writes; a failure after some rows leaves a partially imported schedule. Partial results are summarized but cannot be rolled back automatically. **Not refactored:** first design a server-side validated import plan, preview it, and commit changes in one transaction, including duplicate enforcement.
4. **Schedule import can trust stale/empty fallback data** (`components/ScheduleImportModal.tsx#loadExistingData`; `storageService.ts#getAllMatches/getAllTeams`). Failed server reads can return cached/archive or empty lists, so the preview may miss duplicates or treat existing teams as absent. **Not refactored:** require a fresh authoritative server preflight when the admin clicks Import, and block writes on fetch failure; preserve offline scoring behavior elsewhere.
5. **Admin league deletion uses separate DELETE statements** (`api/leagues.ts`). If one fails, related practice matches/teams and the league can be partially removed. **Not refactored:** use a server transaction, validate league/season, and preserve the official-match deletion guard. Keep repair scripts inactive until independently audited.

### P2 — importer correctness and clarity
6. **Invalid calendar dates and times were accepted**, including Date.UTC silently normalizing nonexistent dates (`utils/scheduleImporter.ts`). **Fixed on QC branch** with row-level validation and tests.
7. **Malformed CSV quotation marks were not detected**; **same-team matchups** were accepted. **Fixed on QC branch** with human-readable row errors and tests.
8. **Rows rejected alongside valid schedule rows were not explained in Preview.** **Fixed on QC branch:** skipped-row warnings before import and partial-error feedback afterward. Changing the season now refreshes the visible preview. Final duplicate indications can still lag asynchronous roster/match loading (see item 4).
9. **Timezone semantics require a deliberate product decision.** `combineDateAndTime` currently encodes entered local-looking times as UTC. Existing fixture tests and stored schedule records depend on it; do not change the conversion without comparing 2026 schedules and establishing America/New_York handling and DST tests.
10. **Duplicate policy is coarse** (`isDuplicateMatch`): same pair, league, and calendar date is a duplicate even if a legitimate second time slot exists. Confirm whether two meetings per day are allowed; add tests before changing it.
11. The importer includes a **hardcoded Nov 2 example schedule** that resembles real fixtures; distinguish sample/example data from an official scheduled import in a future UI pass.

### P2 — structural maintainability and performance
12. `App.tsx` (~1,876 lines), `Scoreboard.tsx` (~1,227), `storageService.ts` (~1,719), and `vite.config.ts` (~480) mix multiple responsibilities. Split each behind tests without altering score-save order, offline recovery, lineup rules, or stored 2025 statistics.
13. `api/matches.ts` and `api/matches-delta.ts` still fetch full match rows/innings JSON for initial and changed game lists. Profile the actual payload sizes before introducing small summary-only endpoints. Do not change the per-match revision protocol casually.
14. `vite.config.ts` contains a separate JSON-file-backed development API with extensive `any` typing; behavior can differ from the deployed Neon API. Prefer contract tests shared by both implementations.
15. Various files contain historical repair scripts, a deployed admin-only `api/fix-crushers.ts` endpoint, hard-coded archives, and large checked-in datasets. Inventory their callers and back up historical information before removing anything.
16. Some server error responses expose technical details (`api/leagues.ts` includes raw DB errors), and some admin screens use browser alerts. Centralize user-friendly messaging while keeping diagnostics in protected logs.

## Release and regression gates
- No changes to Production branch, Production Neon tables, or live Vercel deployment as part of this QC review.
- Use only `review/forensic-qc-nov13` and Neon `br-late-voice-a4kr7gyv` for all tests, with branch-scoped Vercel `Database_url` and independent `SESSION_SECRET`.
- CI must pass TypeScript, every Vitest suite, and Vite build on the **exact review commit**.
- Isolated Preview should return leagues, teams, matches, and settings from the clone, and never connect to Production.
- For the schedule importer: check quoted CSV, invalid dates/times, duplicate rows, swapped home/away, season selection, missing teams, malformed rows, and partial imports in Preview.
- Before broad refactors: add integration tests for offline recovery, exclusive scoring lock, score revisions, emergency takeover, finalization, subs, ghost hitter, forfeits, and Fan Mode.
- Treat each refactor as a separate reviewed change with a straightforward rollback; do not combine server write-protocol rewrites with cosmetic component splits.
