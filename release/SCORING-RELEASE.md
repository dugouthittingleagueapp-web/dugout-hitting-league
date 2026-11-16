# Scoring safety release — November 16, 2026

Status: draft release candidate. Not approved for Production. Cloud Preview configuration and online verification remain pending.

Branch: `release/scoring-safety-nov16`, based on live commit `c6fa6532c0813b8e89168641aced4d9870a3b450`. Ports scoring repairs from development through `2d5da35332d42d0d1ba33ed89e9e22dadaf0f3c2` while retaining the live Admin/Schedule screens and importer. `scope.json` and its regression test enforce this boundary. No schema migration or dependency-version upgrade is included. The lockfile restores missing optional platform package entries required by `npm ci`.

## Repairs included

- Persist a base snapshot and pitch intent before acknowledging the pitch. Storage failure stops input with an actionable message. Recovery retains unsynced commands through refresh and supplies a downloadable copy.
- Send sequential, revision-bound pitch commands with expected previous values. Atomic server validation, ownership and revision checks reject stale writers. Reusing the same write ID safely handles a committed save whose response was lost. Conflicting histories remain available for review.
- Preserve regulation innings and five-, three-, and one-pitch extra innings in journal replay and legacy offline recovery.
- Reject malformed scores, invalid roster references, destructive legacy replacements and inconsistent game flags before committing. Protect finalized results. Preserve substitutions, two-player formats, explicit undo and confirmed admin correction.
- Remove the obsolete repair HTTP endpoint and both development routes. Shared database selection rejects Production endpoints in Preview and connection-routing overrides. Pin this release Preview to its own isolated Neon compute.
- Acquire scoring access and confirm the status save before either dashboard Start Game or lineup Save & Start opens scoring. Failed entry saves stay on the dashboard. Preserve explicit admin takeover.

## Verification completed locally

- `npm ci`, `npm test`: 361 tests in 52 files, including actual PostgreSQL transactions and API handlers; no skipped database suite.
- TypeScript and Vite build checks.
- Browser-to-API-to-disposable-local-PostgreSQL checks: rapid pitches during a hanging request, refresh/retry, committed response loss without duplication, unavailable storage, stale revision, duplicate tabs, each extra-inning format, mobile two-player progression, finalization failure/retry and finalized-game recovery.
- Browser lineup Save & Start, direct Start Game, genuine other-device ownership, failed status save/retry and Save Lineup alone.
- Mobile browser Save & Exit while offline, manual retry, dashboard resume, second-umpire rejection and admin takeover with old-owner recovery copy.
- Existing importer exercised against actual API handlers and disposable PostgreSQL: automatic team creation, game insertion and repeat-import duplicate skipping.
- Tonight's four live game DTOs passed local validation and first-pitch dry runs using a read-only exported fixture. No live rows were modified.

A network reconnect triggers a retry attempt. If synchronization still fails, the umpire may need **Try again**. Repeated automatic retries are not promised. Never clear browser data or discard recovery files while unsynced scores remain.

## Remaining release gates

1. Approve adding **only** `Database_url` and a separate `SESSION_SECRET` to Vercel Preview, scoped to this release branch. Automatic approval review blocked this mutation under the retained prohibition on environment/credential changes. No variables have been added by that blocked operation.
2. The isolated Neon branch already exists: `br-broad-tooth-a40fip7k`, compute `ep-holy-scene-a40t91vm`. It is a copy of Production's schema/data, not the live branch. Use newly created synthetic games for online tests; leave copied real games unchanged.
3. Build and verify the exact release commit online: Preview database safety, umpire lineup/start/pitch, offline refresh/retry, mobile Save & Exit/resume, admin takeover, undo, substitution, forfeit/finalization and fan refresh. Inspect saved synthetic data after each test.
4. Review GitHub CI and the draft PR. Obtain separate explicit approval before merging or releasing Production. Do not promote a deployment built with Preview database settings. A Production release must build with its existing Production environment and pass the Production host guard. No migration is required.
5. Before games, umpires must reopen the released site in a fresh tab after resolving any pending saves in old tabs. Confirm the published commit and database routing read-only. Do not create test pitches in official games.

If deployment fails, keep the current live deployment. If a problem arises after play starts, preserve each device's pending journal/download before any rollback; old code cannot recover the new journal automatically. Coordinate recovery rather than clearing storage or blindly replaying conflicting scores.
