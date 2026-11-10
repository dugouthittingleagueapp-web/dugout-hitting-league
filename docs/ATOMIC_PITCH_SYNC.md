# Atomic pitch synchronization: design and release checklist

This change is intended to **preserve local scoring when connectivity fails**
while preventing a stale complete-match upload from silently erasing scores
entered on another device.

## Score transaction
1. The umpire taps 0–4, or Undo. The browser first writes a **small durable
   operation** (game, inning/round, side, batter ID/index, pitch index, original
   score, desired score) to localStorage.
2. Only if local persistence succeeds does the displayed score change. The
   browser attempts `PATCH /api/pitch` with the operation.
3. PostgreSQL updates a single JSONB score path when the recorded player and
   previous score still match. The database update is atomic, so concurrent
   changes to *different* pitches don't replace one another.
4. A successful server ACK advances the local recovery snapshot, then removes
   only that queued operation. Other pending pitches remain saved.
5. When offline, operations remain in order for retry on reconnect or app start.

PostgreSQL may internally rewrite the JSONB field, but **the API request and
response contain only the individual pitch and a small acknowledgment**.

## When two umpires disagree
- **Different pitches:** both atomic updates can succeed.
- **Same pitch, conflicting edits:** the later update receives HTTP 409,
  remains in the local queue, and is never silently applied.
- The umpire can compare the device score and current server score. Explicitly
  choosing **Keep server** discards only that one conflicting operation;
  choosing **Use device** makes a new compare-and-set attempt using the score
  actually observed on the server. If someone changes it again, it conflicts
  again. If the batter changed, overriding that score is blocked.
- If the server accepted a pitch but its response was lost, a retry may receive
  409. Review is intentional: auto-discarding it could hide a real conflict.

## Legacy whole-match saves
- Full-record PUT requires the Postgres `xmin` row-version token from a recent
  GET/POST/PUT. Old browser tabs lacking it receive HTTP 428 and must reopen.
- For a game using atomic scores, full-record writes wait for queued pitches,
  compare the latest server scoring snapshot against the acknowledged local
  baseline and require an exact row-version match. They never queue an unsafe
  old complete match as an offline retry.
- Legacy offline whole-match backups remain stored, but their automatic replay
  is disabled for games now using atomic pitch saves.

## Tests to perform in isolated Vercel preview + Neon branch before merge
1. Open the same preview game on two devices logged in as umpire.
2. Score 0,1,2,3,4 on different pitches; both devices' scores survive refresh.
3. Edit the **same pitch** differently from both devices. Confirm a 409,
   visible warning, and that no score was silently overwritten.
4. Explicitly choose both conflict-review options in separate test games;
   verify player identity is checked, and newer changes still cause 409.
5. Disconnect one device. Score multiple pitches (including a zero, ghost
   mode, undo and tie breaker), refresh while offline, reconnect, and verify
   exact server-side recovery with no duplicate scoring.
6. Finalize or change the lineup while pitches are pending: it must not
   overwrite newer scores or falsely report success.
7. Open an old browser session and attempt a full-match save: it should
   return 428 with instructions to reopen the game, rather than overwriting.
8. Verify completed official games, standings, forfeits, 2025 archive and
   practice games remain correct.
9. Inspect Vercel network requests: normal score taps should use small
   `PATCH /api/pitch` requests, not PUTs of the entire game.

## Known limitations
- A local browser storage failure blocks new score entry because we cannot
  guarantee a recovery copy; umpires must make space or fix permissions.
- A genuine conflict requires explicit human review; do not automate conflict
  resolution by assuming the latest or locally entered score is correct.
- Simultaneously scoring from multiple **tabs on the same device** has not
  been validated. Recommend one scoring tab per device until tested.
- Changes are in draft PR #5, stacked on prior draft cleanup PRs. No
  production deployment or real-device database validation has occurred yet.
