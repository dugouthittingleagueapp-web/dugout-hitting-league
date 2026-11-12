# Dugout Hitting League — Consolidated Preview for Approval (2026-11-12)

**Status: Preview review only. No Production merge, deployment, or Production database changes are authorized by this document.**

## Baseline
- Started from `refactor/network-and-sync-foundation` at `8c3426342cdbb710c54b56d30e42cb9bbc5bac46`, not from old Production `main`.
- This baseline includes one Exit button, both saving checkmarks, scoring locks/revision safety, offline replay safeguards, updated guide and admin season selector, improved lineup/sub handling, clearer umpire errors, spectator refresh, and existing regression tests.
- Review branch: `review/consolidated-final-nov12`.

## Consolidated changes layered onto baseline
- Added a fail-closed migration-history check: existing untracked league databases cannot silently replay legacy migrations.
- Added a **manual-only** existing-schema baseline script at `scripts/sql/baseline-existing-database.sql`. It handles optional matching scoring locks/revision versions 5–6, validates bcrypt credentials, and makes changes only after independent approval.
- Added an independent Neon Preview branch and branch-scoped credentials. Database selector verifies the exact Preview endpoint; Production endpoints are rejected.
- Added Preview database routing test, single-Exit/save-indicator regression test and student-umpire message guidelines.
- Reused the baseline's already-implemented TLS certificate verification and strong password/secret rules, rather than replacing them with older implementations.

## Other branches reviewed, intentionally NOT blindly merged
- `fix/restore-scoring-save-indicators`: older-base implementation; the current baseline already has a more complete save-state protocol and one Exit button. Do not overwrite it.
- `safety/migration-tls-review-nov12`: older-base implementation; its reviewed migration guard/baseline design was adapted, while keeping the newer baseline's TLS and password policies.
- `refactor/lightweight-dashboard-sync`, `perf/score-button-inp`: divergent work on incremental dashboard refresh, latency, and score patching. Similar fixes already exist in baseline; branch-only changes need their own parity/performance review, not automatic merging.
- `feat/atomic-pitch-sync` and `feature/atomic-pitch-sync`: two **different** experimental individual-pitch API implementations. Each explicitly requires database/device concurrency and offline tests. Enabling either without rehearsing migration and reconciliation could put scores at risk; they are **deferred**, not silently treated as included.
- `fix/nov9-lineup-forfeit-umpire`: ancestor/older fixes already incorporated in development baseline.
- `main`: old deployed Production; intentionally not used as the Preview base.

## Preview QA
- Automated TypeScript, Vitest, Vite and Vercel build must pass on the final review SHA.
- Preview must read leagues, teams, and games from **its isolated Neon database**, never Production.
- Manual umpire smoke test before approval: start official/practice game, lineup with one regular plus substitutes, 0–4 pitch scores, save checkmark in dialog and scoreboard, undo and corrections, two-browser scoring conflict, Wi-Fi outage/reconnect, ghost hitter, tie breaker, finalization and read-only completed game, Fan Mode, admin guide and season selection.
- Confirm no second Exit button.
- No experimental atomic pitch endpoint is enabled in this candidate.

## Production release remains blocked
- Production lacks scoring locks and revision required by the current development version, and legacy migration history is missing.
- Production must receive a separately approved, backed-up and rehearsed additive schema plan before deploying this app version.
- A Preview build alone is not approval to release. Only merge/deploy after explicit user approval and passed scoring regressions.
