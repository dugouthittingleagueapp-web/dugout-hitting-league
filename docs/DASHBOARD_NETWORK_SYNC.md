# Dashboard network refresh — revision-based protocol

The dashboard still loads complete matches on first opening a league, preserving
existing standings, player leaderboards, scoring, forfeits and practice filters.

Every 30 seconds while the dashboard is visible:
1. `GET /api/matches?league=...&season=...&revisions=true` selects only
   `id`, `is_practice`, and `md5(row_to_json(matches)::text)`.
2. If every revision matches, no full match data is transferred.
3. If a game changes, fetch that one complete match by its existing ID.
4. New games are added, deleted games removed, and all other records retained.
5. An error leaves existing displayed records intact and falls back to the
   previous full dashboard refresh behavior.

The full-row fingerprint catches changes that preserve total points (for example
correcting a pitch from 1 to 0 and a different pitch from 0 to 1).

The first revision poll after entering a league performs an additional full
refresh to align the initial snapshot. During the archived 2025 season the
original full refresh remains in use because the legacy bundle may include games
not stored in Neon.

**Do not** use this optimized protocol for umpire match writes. Those still
use full match records, server-verified finalization, and the offline retry
mechanism. The summary endpoint is public and read-only.

## Preview validation checklist

- Open 2026 dashboard, watch a subsequent idle poll; only the revisions
  request should occur once the baseline is set.
- Score one pitch in the isolated preview game; only that changed game's
  complete data should reload, and standings/leaderboards should update.
- Edit a scored pitch from one number to another without changing total points.
  It should still refresh.
- Create a practice match and verify it appears; delete it and verify removal.
- Verify a forfeit's wins/losses and player stats behave exactly as before.
- Verify 2025 archive records are unchanged.
- Exercise interrupted network; no empty scoreboard should replace data.

This is expected to reduce Neon network egress while dashboards are idle.
Measure before and after; no fixed savings percentage has been established.
