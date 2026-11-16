# Phase 2 — Game-Day Reliability

Base: Production release `67ca29b10449b5de689488f8795bb2e52197693b`.
Repair branch: `fix/game-day-reliability`. No Schedule development is included.

## Findings rechecked against the released code

### P1-02 — entry without ownership

The original dashboard Start Game and lineup Save & Start cases were already repaired. Their existing tests pass: acquire before IN_PROGRESS, preserve the source revision, wait for confirmed save, block another owner, and keep ordinary scheduled Save Lineup unreserved. Resume/new-game scoring also passes through Scoreboard's access gate.

One related gap remained: dashboard **Fix Stats** saved a final-game reassignment without acquiring access. An isolated browser run against the unchanged Production source returned 423 / "Scoring is not ready yet" with no existing owner. The modal now acquires access before any roster or game writes. It never requests takeover. Its regression proves that a final game's player assignment can change while every pitch and FINAL flag remain intact, and another admin cannot silently acquire that device's ownership. Ownership is retained just as it is for other admin corrections; explicit takeover remains available through the existing scoring flow.

### P1-03 — fan Next Round and premature advancement

The released component showed Next Round without a read-only/role guard. It checked tied numeric totals while treating unrecorded pitches as zero. An umpire with legitimate ownership could also submit an extra-round append directly; the server validated shape but did not require completion of earlier rounds. Fan API writes were already denied by authentication; this was an exposed UI control, not proof of anonymous database writes.

A shared readiness predicate now requires recorded, tied regulation and recorded, tied prior extra rounds, and excludes finalized/forfeited games. UI controls and the action handler enforce read-only status; repeated clicks are guarded while saving. Server snapshot validation independently rejects premature or multiple-round appends before committing. Round formats remain 5, then 3, then 1. Earlier scores are preserved.

### P1-06 — recovery retry

The released retry cleared the warning and attempted upload before acquiring available scoring access. It also replayed unrelated queued games and could resolve without successful synchronization. A retained pitch with a missing lock could require another click or remain blocked.

Retry now validates the recovery record, acquires this device's access, replays only the selected game's original commands/snapshot, and confirms that nothing remains pending. Failed access never clears the recovery warning. Upload failures retain the original write ID, revision, expected cell value and complete recovery copy. A genuine newer-server revision still requires staff comparison; automatic rebasing or takeover would risk overwriting live scores and is deliberately excluded. Offline, foreign-owner and stale-revision responses remain failures, not success messages.

## Reproduction and verification

All data mutations were confined to disposable local PostgreSQL databases with explicit localhost/test-name guards. No cloud deployment, push, merge, migration, Production credential change or Production database write was performed.

The new unit/API regressions were run against an isolated checkout of the original release first: 15 failed and 1 passed (the existing concurrency/ownership protection). All 16 pass after repair. The original admin correction browser workflow separately failed with the expected missing-access 423; the repaired workflow and foreign-owner negative check pass.

Evidence logs are under the ignored `work/` directory. See `tests/browser/PHASE2.md` for local browser commands. Final verification: **377 tests in 53 files passed**, including all 41 real PostgreSQL scoring tests; no database suite was skipped. `npm run lint` (TypeScript) and `npm run build` passed. Browser/API/local-database checks passed for the new round/retry/correction cases and the existing rapid scoring, lost responses, storage failure, offline refresh, 5/3/1 recovery, two-player 15th pitch, substitution/undo, forfeit, finalization failure/retry, finished-game recovery, lineup/start, mobile exit/resume and admin takeover flows. Native Node ESM API loading also passed. The fan control additionally reproduced against the unchanged release UI (expected zero Next Round buttons, actual one).

Verification did not rely on compilation alone. Chromium fault-suite teardown emitted Playwright route-cancellation diagnostics after its successful checks; no application page errors occurred. These are runner cleanup diagnostics, not claimed clean test-runner stderr.

## Remaining limits and recommended next step

- A real competing score history is preserved for manual staff review/download; retry cannot safely merge it automatically.
- Repeated automatic network retries were not added. Manual retry is still sometimes necessary.
- Browser tests use Chromium and a mobile viewport with synthetic test sessions. Physical umpire devices and real password entry require a later Preview smoke test.
- No deployment has been made for this phase. After review, approve a separate isolated Preview deployment and test extra-round progression, retry and admin correction on actual devices before considering Production.

## Initial Extras popup follow-up

The initial setup popup could be opened by scoring the last regulation cell even when earlier pitches were blank. Its safety-disabled Start Extras button still looked orange, it had no reason or return action, and portal text/selects lacked explicit dark-mode colors. The earlier online checks covered advancing existing extra rounds but missed this initial-popup path.

The automatic prompt now requires recorded pitches across all regulation innings. Explicit early Extras explains the block, styles its disabled button clearly, and offers Back to scoring. The popup has labelled selectors, explicit high-contrast light/dark colors, busy feedback and visible save errors. The exit wording correctly describes the existing 5/3/1 formats. Scoring protections are preserved.

The new browser regression checks an incomplete game, returning to scoring, text/select contrast of at least 4.5:1, and first-round creation after a held final-pitch save, including both chosen batters and preservation of all regulation scores. The complete local suite now passes 379 tests, TypeScript and the build. This follow-up is Preview-only.

## Recorded-score tie follow-up

The initial completion flow still depended on entering a new final home pitch. Editing recorded regulation or extra-round scores to a tie did not open setup. Completion prompts now follow the whole before/after score state, including edits and filling the last missing pitch out of order. They never prompt with unrecorded pitches, on finalized games, or on the first of two ordinary corrections that temporarily breaks a tie. Score edits close the editor rather than advancing to another pitch.

A completed tied regulation game also exposes Start Extras after takeover or refresh; returning from setup does not require another score edit. Setup describes the actual next pitch limit. A dedicated browser regression performs admin takeover, edits regulation to 1-1, refreshes/reopens setup, and edits a completed extra round to a tie before advancing to three pitches. Every prior score is checked. Full local validation passes 384 tests plus TypeScript/build and the existing scoring fault/substitution/finalization browser flows. Preview only; no Production changes.
