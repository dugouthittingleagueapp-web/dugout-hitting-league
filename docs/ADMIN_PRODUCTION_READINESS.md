# Admin release readiness — November 19, 2026

Production has not been changed. PR #11 remains a draft pending owner acceptance and release approval.

## Release scope

Base: Production `778ef94584096ebde90911d539b90f33e06ae2b3`.
Candidate branch: `fix/schedule-import-league-provisioning`.

Included:
- Central Admin Schedule: active-season CSV mapping, league/team provisioning, duplicate receipts and cage/team conflict checks; protected edit/remove and team rename.
- Admin Rosters: create a team with three initial player fields, manage substitutes, preserve roster IDs, match returning players during or after entry, and autofill both names on selection.
- Separate teams with the same name in different leagues or seasons; schedule imports reuse only the correct league/season team.
- Permanent player identities and ID-based career history, including nickname suggestions that require confirmation.
- Earlier approved Preview fan-scoreboard scrolling and previous-pitch confirmation display.
- QC repairs: legacy roster saves require a valid server confirmation before updating cache or proceeding; rejected requests are never queued as offline roster success. Stale legacy payloads cannot drop saved roster IDs. Team deletion, moves and season changes display server rejection correctly.

Excluded: TeamLinkt roster import (canceled), automatic title casing (discussed only), a new scoring protocol, and new game Notes fields. Legacy stored notes are preserved.

The scoring endpoint, match-write endpoint, scoring journal, offline-sync module and scoring protocol remain byte-for-byte unchanged from the Production base. Their integration with the updated team service is covered by regression checks.

## Database release prerequisite

Read-only Production inspection found 30 teams, 65 matches, active season 2026, and **no** `league_players` or `player_identity_links` tables. Deploying the candidate without the additive identity migration would break roster/history workflows.

Prepared private artifacts under ignored `work/`:
- `admin-production-identity-plan.json`: exact stable UUID manifest from the read-only roster snapshot; do not regenerate UUIDs between review and execution.
- `admin-production-identity-release.sql`: reviewed-snapshot guard, additive DDL and mapping inserts in one transaction.
- `admin-identity-rehearsal-result.json` and `admin-career-comparison.json`: local evidence.

The manifest maps 97 existing roster IDs to 89 people. Eight clear historical associations are retained. Eleven ambiguous 2025 entries stay separate and available for later manual matching; no identity is guessed. All 51 current-season entries have identical career totals under live code and candidate code, using the same read-only snapshot of all 65 stored matches plus bundled historical records.

The SQL generator (`scripts/player-identity-release-plan.ts`) **only writes a review file** and never connects to a database. It rejects incomplete/duplicate mappings. The generated transaction locks roster writes briefly, checks every team/roster against the reviewed snapshot, refuses conflicting existing identities, and inserts without rewriting teams, matches, pitches or statuses. The exact manifest was applied and reapplied in an isolated local schema, starting without identity tables, preserving all copied roster rows and a synthetic FINAL game with regulation and extra-inning scores. Regression tests also exercise changed-snapshot and conflicting-identity rollback.

Do not use the general migration runner on the existing Production schema. Do not run browser fixture setup against any cloud database. Do not promote a Preview that carries Preview database settings into Production.

## Validation

Automated suite, TypeScript/build, actual local-browser workflows and deployed Preview acceptance are separate checks. Final counts and Preview deployment are recorded in the PR/release handoff.

Local browser coverage uses the actual React UI, API handlers and disposable localhost PostgreSQL:
- Desktop/mobile Schedule import, edits, renames, remove confirmation, archive isolation, retries and league-dashboard updates.
- Team creation before/after import; three-player default; substitutes; interrupted/hanging/lost-response saves; duplicate-free retry and draft retention.
- Concurrent roster editing, returning-player selection/autofill, different-player confirmation, manual identity links, career totals, and same-name teams in different leagues.
- Scoring ownership, scheduled lineup/start, Fix Stats on FINAL games, protected extra rounds (5 → 3 → 1), offline refresh/retry, hanging/lost responses, blocked storage, duplicate tabs, conflict downloads, two-player lineups, substitutions, undo, forfeits and finalization.

Browser fault-injection runs may print Playwright cancellation messages while intentionally aborting held requests. These are distinguished from failed assertions/process exits. Desktop Firefox at mobile dimensions is not an Android Firefox device certification.

## Release procedure — after explicit approval only

1. Confirm no game is being scored or corrected; capture a fresh read-only database baseline and restore point. Recheck the current live deployment and the reviewed candidate SHA.
2. Recheck the roster snapshot. If it differs, stop and regenerate/review the mapping while preserving already approved identity decisions; do not override the guard.
3. Apply only the reviewed additive identity SQL to the verified Production Neon branch in its transaction. Verify 97 links/89 people and unchanged team/match fingerprints before deployment. If a verification fails, stop; do not deploy.
4. Release the exact reviewed candidate through the Production build path using existing Production environment settings. Verify the database endpoint safety check, build/READY state and read-only live pages. Never point Production at the Preview database.
5. Verify Schedule/Rosters/history load and current career totals. Any intentional synthetic mutation test belongs in isolated Preview, not live historical games.
6. Monitor errors and game entry. If needed, roll back application code to the known Production deployment; retain additive identity tables. Do not drop tables or reverse roster/match data as an application rollback.

## Remaining acceptance and limits

The owner should check the refreshed protected Preview: create/edit one synthetic team, select a returning player, and import/edit one synthetic booking. No public share or credential changes are needed.

No Production migration, merge, deployment or live writes have been performed. Protected cloud acceptance requires the owner's normal login; passing local end-to-end checks does not claim a deployed authenticated workflow was exercised. Android Firefox font scaling requires the user's real device. Existing external font/Tailwind CDN availability and the build's large-bundle warning remain operational considerations outside this repair scope.
