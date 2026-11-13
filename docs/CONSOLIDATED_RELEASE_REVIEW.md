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

## Complete GitHub branch audit (2026-11-13)

All ten currently listed branches were compared against this consolidated review branch. The following classifications are based on inspected source files and open PR descriptions, not simply on commit counts.

| Branch / preview work | Disposition in consolidated preview |
| --- | --- |
| `main` | Older Production release; all ancestors retained in review history, no Production changes |
| `fix/nov9-lineup-forfeit-umpire` | Earlier merged fix already included in foundation |
| `refactor/network-and-sync-foundation` | Direct foundation; scoring locks, offline safeguards, guide, admin and saved indicators retained |
| `fix/restore-scoring-save-indicators` | Alternate older-base implementation superseded by foundation's more complete status events. The ✓ confirmation, saving, offline and attention states remain present |
| `safety/migration-tls-review-nov12` | Schema-baseline guard and manual six-migration baseline incorporated; newer foundation's TLS and credential protection retained instead of copying legacy files |
| `refactor/lightweight-dashboard-sync` | Functional goal already covered by foundation's `api/matches-delta.ts`, 304 dashboard signatures, match revision cache, and tests; no duplicate polling hook |
| `perf/score-button-inp` | Previously incomplete: now integrated tested immutable 0–4 score, undo, tie-break helpers and removed duplicate haptic. Existing safe save/revision handling retained |
| `feature/atomic-pitch-sync` | **Experimental and excluded:** competing `/api/pitches` implementation; requires multi-device + outage safety tests |
| `feat/atomic-pitch-sync` | **Experimental and excluded:** competing `/api/pitch` implementation; requires same independent safety tests. Cannot safely include both competing APIs |
| `review/consolidated-final-nov12` | Current review build; contains the above verified stable features plus isolated Neon preview, guide scroll, admin button priority and regression tests |

### Additional friendly umpire wording
Easy-to-understand roster and practice-game alerts were carried over from the atomic feature branch independently of its untested pitch-saving protocol. Lineup minimum-player logic was deliberately left untouched so the previously repaired one-regular-plus-subs workflow is not reverted.

### No false 100% promise
An identical cherry-pick of every branch would overwrite later security and scoring controls or enable incompatible draft APIs. This review includes safe features and **records all excluded experimental branches**; it does not assert that all untested code is release-ready.

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
