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
