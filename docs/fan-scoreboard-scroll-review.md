# Fan scoreboard scrolling review

Branch: `fix/fan-scoreboard-scroll`, based on Production main `778ef94584096ebde90911d539b90f33e06ae2b3`.

The reported failure is Android Firefox not reaching the home team's third hitter. Chrome on the same phone works. Firefox automatic font sizing follows Android settings. Desktop Firefox did not reproduce the original cutoff, including at larger text sizes; Android's touch handling remains unverified.

## Local changes

- Keep vertical scrolling on the App main element. Remove redundant overflow containers around the scoreboard and allow the flex main element to shrink within the viewport.
- Render read-only pitch values as accessible, noninteractive elements instead of disabled form controls. Native disabled controls can intercept gestures differently between browsers. Editable umpire tiles retain their buttons and handlers.
- Read-only tiles cannot render a score editor or install its body touch-scroll blocker, even if an editing selection remains set.
- Preserve text sizing and zoom preferences. No font-size override, database/API changes, or Schedule changes.

## Verification

- Full automated suite: 392 tests across 54 files passed, including isolated PostgreSQL integration tests.
- TypeScript and production build passed.
- New read-only tile regression tests cover scores 0–4, empty pitches, editable controls, and a stale editing selection after switching to read-only.
- `tests/browser/fanScoreboardWorkflow.py`: Chromium and desktop Firefox at a 393×780 viewport, with 16/20/24px root text. Checks all six hitters, read-only taps, lack of redundant vertical scroll owners, reaching the final home row, horizontal access to pitch 10, and inning navigation. Chromium additionally checks a native touch swipe starting on a score tile. Firefox checks use wheel scrolling; they do not emulate Android Firefox's touch pipeline.
- Existing browser scoring operations workflow passed against the local synthetic database: substitutions, pitch entry/undo/replacement, rejected malformed and destructive writes, forfeit score preservation, and anonymous fan write denial.

## Isolation and next step

All database activity used disposable localhost PostgreSQL databases. No cloud deployment, merge, Production environment change, or live/historical database write was performed.

Before calling the reported problem fixed, publish an approved isolated Preview connected to a verified testing database, then check Firefox on the user's Android phone with automatic font sizing enabled. Swipe upward starting on both score tiles and empty areas, reach all three home hitters, scroll horizontally to pitch 10, switch innings, and confirm live score refresh. Also check Chrome and iPhone Safari. Production promotion requires separate approval.

## Previous-pitch confirmation

The user also requested the previous recorded pitch at the top of the scoring modal, with no undo reminder. The existing Undo Previous button remains unchanged. The display uses the preceding pitch for the same batter and round, includes zero, and never borrows a result from another batter or an earlier extra-inning round. Scoring writes, recovery, and ownership behavior are unchanged. The modal can scroll internally when larger text or a small viewport requires it.

Local browser checks passed: regulation scoring, zero points, undo/re-entry and the actual persisted replacement, refresh, 150% text controls, the two-player pitch 10/11 ghost-row boundary, five- and three-pitch extras, and no previous-round score on one-pitch extras. Full suite after adding the Preview database pin: 393 tests across 54 files passed; TypeScript/build passed.

Preview deployment is authorized without further approval. This branch is pinned to testing endpoint ep-holy-scene-a40t91vm (br-broad-tooth-a40fip7k); only branch-scoped Preview Database_url and SESSION_SECRET were added. No Production environment setting is changed.
