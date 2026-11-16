# Phase 1 scoring safety design

Base: `1af7225`, repair branch `fix/critical-scoring-safety`. No deployment,
cloud database writes, schema migration, or unrelated P1/P2/P3 repair is part
of this work.

## Invariants

1. An accepted pitch has a read-back-verified, durable browser journal entry
   **before** totals, pitch navigation, or the scoring cell acknowledge it.
   This happens independently of the network request queue. Storage failure
   rejects input; it is never reported as an offline success.
2. Journal commands change one identified regulation/extra-inning pitch and
   include its expected previous value. They never replace a game snapshot.
   They use the versioned `/api/scoring` route, which is absent on older
   backends, rather than sending unknown command fields to a legacy writer.
3. A command uses its actual source revision, or the acknowledged revision of
   its explicit parent command. A read, profile modal, other tab, or unrelated
   response cannot supply a replacement revision.
4. A server transaction locks the game, validates ownership and command, checks
   revision, applies the command, and commits a retry receipt with the game.
   Lost responses are retried with the same ID. No new database table is needed:
   the latest per-game receipt uses the existing app_settings key/value store.
5. Journals have unique immutable command keys and an immutable base snapshot.
   Separate tabs cannot clobber a shared read/modify/write queue. Branches or
   stale commands stop for review; no automatic last-writer-wins merge occurs.
6. Regulation, 15-pitch two-player innings, 5/3/1-pitch extra rounds, zeroes,
   explicit edits and undo are covered by the same command/recovery protocol.
7. Legacy pending snapshots and unreadable backups are preserved. A version
   change never clears unknown recovery data. Recovery offers a credential-free
   download and safe retry; it never blindly rebases stale scores.
8. Full-snapshot API callers cannot erase or change existing results. Structural
   operations are validated, and explicit practice reset/admin attribution
   intents have narrow, server-checked exceptions. Final results remain locked
   to umpires.
9. The obsolete repair HTTP endpoint is removed. Remaining HTTP handlers use
   the guarded database pool; maintenance scripts are not reachable as APIs.

## Evidence and release gate

Regression tests must reproduce the audit's hanging-request, storage-failure,
stale-read revision, lost-response, extra-inning recovery and malformed-write
failures. Browser tests exercise the actual handlers against synthetic local
PostgreSQL data. Run the complete test suite, TypeScript and production build.
Keep changes in small local commits. Publishing or deploying this repair needs
separate user authorization because pushing can automatically deploy Vercel.

## Repair coverage

| Finding | Repair | Regression evidence |
| --- | --- | --- |
| P0-01 | Synchronous verified journal write before score/navigation changes; bounded requests; retained commands and same-ID replay | `scoringJournal.test.ts`: hanging request/body, unavailable/full/ignored storage, lost response, failed acknowledgement storage; browser: rapid input, refresh, session-token loss, retry, storage failure |
| P0-02 | Exact source revision and explicit command parent; server row lock and cell compare-and-set; no read-based revision substitution | Journal stale-parent and duplicate-tab tests; PostgreSQL concurrent-writer and receipt transaction tests; browser profile-read and copied-tab conflicts |
| P0-03 | Complete regulation and extra-round command reconstruction; legacy acknowledgement must include all saved scores | Journal 5/3/1 rounds and undo; legacy missing-extras response test; browser offline refresh and edit in each extra-round format |
| P0-04 | Runtime structural/point/roster/forfeit checks; legacy snapshots cannot remove/change existing scores; explicit narrow practice reset and admin attribution intents | `scoringValidation.test.ts` and real PostgreSQL invalid requests, rollback, substitutions, 15th pitch, extra rounds, undo, finalization, forfeit and final-game protection |
| P0-05 | Obsolete repair HTTP routes removed; API handlers use guarded pool; all Preview branches reject Production host and driver-routing overrides | `maintenanceIsolation.test.ts`, database routing tests, native ESM API loading |

## Recovery and operational limits

Verification on the repair branch:

- `npm test` with an isolated localhost PostgreSQL test database: **396 tests in
  54 files passed**. This includes 33 real PostgreSQL scoring tests, 28 state
  validation tests, 19 journal tests and 7 maintenance-isolation tests.
- `npm run lint`: passed (`tsc --noEmit`). `npm run build`: passed.
- Chromium scoring fault workflow: real UI, API handlers and synthetic local
  PostgreSQL, including desktop and mobile viewport cases. This is local browser
  verification, not verification of a deployed Preview or physical umpire phone.
- Existing Schedule browser workflow: passed its 48-game import, active/archive
  isolation, rename, edit, removal, refresh and mobile regression checks.
- Logs are local ignored artifacts under `work/qc/phase1-*`. No cloud database,
  deployed site, environment credential or schema was changed by these checks.

- A recorded pitch may be accepted while offline **only after its recovery record
  is verified in browser storage**. The banner distinguishes local-only scores
  from confirmed server scores. The journal is not a guarantee against clearing
  browser data, device loss, filesystem failure or browser eviction.
- If storage cannot be verified, the pitch is not accepted. Leave the game open
  and get league staff help. A full journal blocks new input rather than deleting
  old entries. Acknowledged commands are retained; safe automatic cleanup is not
  included in this phase.
- Retry uses original commands and identities. Conflicts, ownership changes,
  malformed backups and ambiguous branches stop for review. Download saved scores,
  keep the device and original browser data, and have league staff compare the
  copy with saved server scores. There is intentionally no force-overwrite button
  or automatic import of an unreviewed recovery file. Exports omit credentials.
- Starting extra innings, changing lineups, leaving and finishing require server
  confirmation after pending pitches synchronize. Offline scoring can continue
  within the existing lineup/round; an offline structural change is not reported
  as successful.
- Already-open older clients retain their previous behavior until reloaded.
  The versioned command route protects new clients from an older backend. This
  phase does not change the previously reported P1/P2/P3 findings.

## Recommended Preview acceptance procedure

Scheduled-game entry follow-up: both dashboard Start Game and lineup Save & Start
must acquire scoring ownership **before** attempting the protected IN_PROGRESS
save. The captured source revision is retained and navigation waits for the saved
response. A missing-access error no longer falsely claims another umpire owns
the game. Ordinary Save Lineup on an unowned scheduled game does not reserve it.
The follow-up suite passes 403 tests in 55 files, TypeScript and build; the local
browser regression covers both entry paths, an actual other-device owner,
failed status saves, saved batting order and the first recorded pitch.

Only after separate authorization to publish this branch:

1. Verify the repair deployment uses the intended isolated Preview database and
   contains both the new client and `/api/scoring` handler. Use a synthetic league.
   Do not promote the deployment or connect it to live game data.
2. On the actual umpire phones/tablets, enter rapid pitches, disable networking,
   record more pitches, refresh, reconnect and verify every pitch server-side.
   Repeat with a lost response, undo, a substitute and a two-player 15th pitch.
3. Test all 5/3/1 extra-round formats offline through refresh and edit. Confirm
   the recovery download contains the missing intent and no access credentials.
4. Open the same game on a second device/tab. Verify stale scoring is rejected,
   both recovery copies remain available, and staff can compare them safely.
5. Attempt to finish with unsynced scores and with a failing connection. The app
   must stay open without claiming completion. Reconnect, finish, then verify
   umpire final-game protection, fan totals and official statistics.
6. Confirm ordinary Schedule import/edit/rename still works. Review remaining
   audit findings before any decision to use this candidate for live games.
