# Dugout Hitting League — repository audit (2026-11-11)

Scope: branch `refactor/network-and-sync-foundation`. Production `main` remains unchanged. This is a code and repository-inventory audit; it is not a full penetration test, production traffic benchmark, or proof that every feature is covered.

## Findings, ordered by impact

### P0 / Protect live games and access before any broad refactor

1. **Server session signing has a checked-in fallback secret.** `api/auth.ts#getSessionSecret` falls back to a hard-coded, publicly visible HMAC key when both `SESSION_SECRET` and `ADMIN_SECRET` are missing. The deployment must be checked for an explicitly configured strong server-only session secret; only after confirming configuration and an appropriate session-rotation plan should the fallback be removed. A hard-coded fallback can permit forged admin/umpire sessions on misconfigured environments.
2. **“Reset Cache & Reload” currently clears the whole browser's localStorage.** `index.tsx#ErrorBoundary.handleHardReset` calls `localStorage.clear()`. `storageService.ts` deliberately uses localStorage for unsynced scores, recoverable match snapshots and scoring conflict records. A reset during a Wi-Fi outage could destroy unsubmitted scoring data. Replace the destructive reset with a narrowly scoped, offline-safe recovery flow and test it.
3. **Scoring writes still transfer the entire match.** `services/storageService.ts#performMatchUpdate` serializes and PUTs the full match; `api/matches.ts` updates an entire innings document and returns `RETURNING *`. This is the main remaining potential Neon bandwidth hotspot during scoring. Do not switch to per-pitch writes without maintaining revision checks, scoring lock enforcement, ordered saves, offline replay and forfeit/tie-breaker semantics. A separate dedicated scoring endpoint is a future design task, not a safe cleanup-only edit.
4. **Review deployment SSL and secret configuration.** Vercel flagged database environment variables as readable Config entries rather than Secret; ensure credentials remain available while changing their classification, and plan rotation. Recent Preview changed TLS verification and requires end-to-end connection tests before release.

### P1 / Reduce complexity without behavior change

5. **Large, tightly coupled modules.** `App.tsx` (~143 KB / 2,171 lines) mixes navigation, authentication, dashboards, aggregates and data fetching. `Scoreboard.tsx` (~81 KB / 1,350 lines) mixes scoring UI, state, network synchronization and Fan Mode. `storageService.ts` (~82 KB / 2,089 lines) mixes HTTP, offline persistence, match/roster access, statistics and historical archive. Extract feature-level hooks and pure utilities in small commits, with regression tests after each.
6. **Duplicate normalization and score calculations.** `services/storageService.ts#mapMatchFromDB`, `services/matchHelpers.ts#normalizeMatch` and API row mappers overlap and can disagree (ID prefixing, default season, revision, status). Consolidate only after parity fixtures for practice IDs, 2025 archive, forfeits, edits and tie-breakers.
7. **Dashboard refresh now uses an incremental API**, but verify that every match update bumps its revision and that `api/matches-delta.ts` includes the correct league/season filters and practice semantics. Add tests of multi-tab refresh and open dashboard vs active game before further change.
8. **Inconsistent error messages and logging.** Centralize friendly umpire-facing errors in `utils/friendlyErrors.ts`; reserve technical diagnostics for console/server logs. Audit reset, lock conflict, expired-session and offline recovery flows.
9. **Development API simulator inside `vite.config.ts` is unusually large** (~22 KB) with separate in-file JSON persistence. This can drift from Vercel/Neon behavior. Prefer a slim local dev facade or explicit test fixture, not two divergent API implementations.
10. **Overbroad function entry points:** `api/matches.ts` handles list, get, create, update and delete. Split by operation behind stable API interfaces only after integration tests; avoid disrupting existing clients.

### P2 / Repository and bundle hygiene

11. **Empty `.gitignore`.** Sensitive or machine-generated files can be added accidentally. Add ignore rules for `.env*`, `node_modules/`, `dist/`, logs, temporary files and local IDE files while preserving tracked fixtures. Important: adding ignore rules does not remove already tracked files.
12. **Large checked-in datasets/media.** `.data/db.json` (~3 MB), `.data/seedData.json` (~0.8 MB), `services/archive2025Data.ts` (~0.7 MB), and `public/assets/aistudio/` (>5 MB of image/JSON material) deserve a usage and provenance audit. Do not delete archived scores or exports without confirming an authoritative durable copy. Public assets are publicly reachable when deployed.
13. **Both `bun.lock` and `package-lock.json` are checked in.** CI and Vercel appear to use npm. Once confirmed, keep one package manager and lockfile to prevent dependency drift.
14. **Potential obsolete admin repair endpoint/script:** `api/fix-crushers.ts` exposes a guarded one-time database migration. Confirm whether the repair has already run and whether this route is still needed, then retire safely. Review old scripts the same way.
15. **A React build injection of `process.env.API_KEY` was present in `vite.config.ts`.** Since no bundled feature was identified requiring it, remove this injection; never put server secrets into client-side build replacements. The removal has been committed separately and must pass CI.

## Suggested staged cleanup

1. **Safety:** add/offline-test protective reset behavior, verify server-only signing secret configuration, and harden repository ignore rules. Do not rotate live secrets without a controlled deployment plan.
2. **Pure functions:** centralize match normalization, statistics and lineup helpers, with regression fixtures to guard historical game behavior.
3. **Networking:** separate typed API access from offline sync and statistics; profile full-match PUT size versus compact pitch updates before changing the scoring API.
4. **UI:** split App/Scoreboard into dashboard, scoring session, Fan Mode and reusable presentation layers, preserving existing workflows.
5. **Hygiene:** prune confirmed unused media, one-time migration code and redundant package manager files after verifying references and backups.

## Non-negotiable release gates

- No changes to production `main` without user approval.
- CI typecheck, complete automated tests and production build.
- Preview device tests: exclusive scoring lock, lineup with substitute/ghost/forfeit, offline pitch queue/reconnect, score updates/undo/tie-breaker, finalize, dashboard refresh and Fan Mode.
- Compare preview telemetry with baseline when possible; do not claim quantified performance improvements from code inspection alone.
