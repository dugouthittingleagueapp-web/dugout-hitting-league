# Atomic pitch synchronization — draft rollout checklist

**Do not merge to production until preview/staging tests pass.**

## Data-safety contract

- Every 0–4 score, edit, and undo is applied optimistically to the umpire UI.
- The updated **complete match** is persisted on the umpire's device before any network request.
- A persistent ordered queue holds each pitch edit, including expected old score and player ID. A network failure leaves it queued for replay.
- `PATCH /api/pitches` sends only the one edit, checks current score and player under a PostgreSQL row lock, then updates only that JSONB path.
- Changing a different pitch from another device can succeed safely. Conflicting edits to the same pitch return HTTP 409, keep the local queue, and require an umpire/admin to reconcile rather than silently overwriting.
- Score zero, score edits, undo (null), and tie-breaker rounds have the same protection.
- Full-match PUT (lineup/finalization/admin corrections) requires a matching server fingerprint for the scoring document and refuses saves while local pitches are pending.
- Existing legacy full-match offline queues may contain snapshots without fingerprints. These are deliberately **not** replayed over newer server scores; a manual review is required.

## Important user-facing caveats

- A network outage can leave scores saved **only on the device** until synchronization succeeds. Keep that device/browser data intact.
- A conflict should be reconciled by comparing the device's locally stored scores against the server match; do not clear site data or recreate official games.
- When pending edits have synchronized after a disconnected session, reopen the game before any full-match action. A safe guard may refuse to finalize until the latest version has been loaded.
- This endpoint is experimental until tested against the Neon preview database and real touch devices. GitHub TypeScript/tests alone cannot validate PostgreSQL JSONB behavior in production.

## Isolated Neon preview tests

1. Two separate browser sessions load same new practice game. Umpire A scores away pitch #1 as 2; B scores home pitch #1 as 3. Both persist after reload.
2. Same pitch conflict: A scores 2, B attempts 4 from a stale view. B receives actionable conflict; A's 2 remains.
3. Take A offline. Enter 0, 1, 2, 3, 4 on consecutive pitches, plus correction and undo. Confirm pending banner shows offline saves, reconnect, retry, reload, and compare all scores.
4. While A offline, edit a **different pitch** from B. After reconnection, both updates must survive.
5. While A offline, edit the **same pitch** from B. After reconnection, the server's value must survive and A's pending edit must remain available for admin review.
6. Repeat basic scoring and undo in tie-breaker rounds.
7. Attempt lineup change/finalize with unsynced pitches: must block. After successful reconnect, reopen and finalize normally.
8. Attempt full match PUT from a stale browser after another device changed any pitch: must return 409 and preserve the newer result.
9. Confirm practice game reset, force-forfeit, season standings, and historical archive still work.
10. Compare total `/api/pitches` request bytes versus previous complete-match `PUT /api/matches` request. Monitor Neon latency and errors.

## Deployment order

1. Merge and test PR #2 (network foundation).
2. Merge and test PR #3 (dashboard delta refresh).
3. Merge and test PR #4 (INP optimized scoring UI).
4. Validate and merge this PR only after live preview testing and independent backup.
