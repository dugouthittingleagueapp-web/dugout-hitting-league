# Dugout Hitting League — cleanup roadmap

This plan is intentionally incremental. Production scores and existing match records are the source of truth. Every phase needs automated tests and preview validation before merging.

## Architecture

- `App.tsx` (~2,172 lines): navigation, authentication, dashboards, standings, weekly leaderboard, and data loading are coupled. Split into feature modules/hooks after preserving existing behavior with tests.
- `components/Scoreboard.tsx` (~1,249 lines): scoring, lineup editing, tie-breakers, synchronization, spectator updates, and finalization belong in focused hooks/components. Reuse `utils/lineupHelper.ts` and `services/matchHelpers.ts` instead of duplicating lineup and forfeit logic.
- `services/storageService.ts` (~1,815 lines): separate API client, typed read repositories, offline sync, score helpers, and historical archive access. Do not change offline behavior without a dedicated test of interrupted connections.
- `api/matches.ts`: the dashboard GET currently selects every column, including full `innings` JSON, for every match. It is the largest identified avoidable *database transfer* opportunity.

## Network / Neon transfer priorities

1. **This PR:** coalesce only simultaneous identical GETs; no stale response cache. Single-flight reconnect sync; a single reconnect listener.
2. **Next PR:** implement a compact, read-only match summary API to avoid transferring pitch-by-pitch arrays on every dashboard poll. Maintain full match GET for scoring/stats or fetch on demand. Preserve practice, status, date, forfeit and score totals, season and league filtering. Add parity tests against the original endpoint and compare Neon response bytes.
3. **Next PR:** split cached roster metadata from match-score reads; avoid full-roster requests when no roster changes occurred. Measure transfer and avoid lengthy stale caches.
4. **Later:** evaluate database-side response compression or narrower SQL SELECT and pagination; keep spectators reasonably up to date.
5. **Later:** evaluate the checked-in historical JSON and `services/archive2025Data.ts` payloads to reduce browser bundle size. Never delete or rewrite archived league data before verifying it remains available from a durable source.

## Critical concurrency and safety work

- Browser write queue serializes same-device match updates, but edits from **two devices** can still overwrite one another because the API accepts full-record PUTs. Add optimistic concurrency or per-pitch updates with conflict handling **before** claiming multi-umpire safety.
- Offline queued full match documents could overwrite fresher scores after a reconnect. Develop an explicit conflict policy and test it against a staging branch, not production.
- Existing score-preservation rules intentionally block removing players once recorded points would be lost. Preserve historical innings and scored zeros during refactoring.
- Keep all existing authorization and forfeit rules, including the distinction between registered substitutes and the three official players.

## Verification gates for every phase

- CI typecheck, scoring/forfeit/ghost-mode tests, and production build.
- Preview Neon database branch (never production), with a fresh match, legal/forfeit lineup changes, save/reload, and finalizing.
- Check current official matches and standings remain unchanged on production after an approved release.
