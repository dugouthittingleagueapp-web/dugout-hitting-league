# Schedule conflict resolution — Preview

The Admin Schedule editor now handles one game or a set of conflicting games in the same window. A conflicting CSV opens that same editor after its league destinations are selected. There is no suggestion wizard or separate conflict-check action.

## Behavior

- The game being edited stays first. Conflicting existing games appear underneath, with their own date, times, cage and home/away team controls. CSV rows stay in their original import order; newly affected existing games are appended as needed.
- Both cage and team conflicts are reported for every overlapping pair, using the actual overlap interval and team name. Adjacent bookings are allowed. The complete active-season calendar is checked across leagues and outside the dashboard filters.
- Edits validate immediately. Changing another game's booking can add further affected games to the window. Sections remain visible after resolution so the admin can review all edits.
- Finished, started, scored (including recorded zero), forfeited, malformed-scoring-data and umpire-owned games are read-only. They can be displayed as conflicting context without allowing a write.
- Notes are editable only when a game or imported row already includes notes. New blank games do not introduce a Notes field.
- Save Changes is disabled while conflicts or invalid fields remain. Cancel performs no mutation. The modal has a scrollable mobile layout, persistent actions, keyboard focus containment and focus restoration.
- A background refresh checks for other administrators' changes while the window is open. Server changes update untouched fields; local edits remain visible with a notice showing the updated server values. Protected/removed games become read-only. Every save still checks current revisions and all conflicts under database locks.
- An uncertain save keeps the exact draft/request identifier for a safe Save Changes retry. Editing is paused until that save is confirmed, preventing a late response from becoming a different mutation.

## Server contract and transaction

The existing `/api/schedule-admin` endpoint handles:

- `preview_resolution`: active season and optional CSV/mapping → complete editable calendar workspace. No writes.
- `resolve_schedule`: active season, stable request UUID, booking changes and optional original CSV/mapping → one atomic save.
- `preview_import`: adds a resolution workspace when conflicts exist. Ordinary conflict-free imports retain the existing workflow.

The server derives game identity, league and protections from stored rows and the freshly rebuilt import plan. It rejects supplied scoring/status fields. The complete final calendar is validated with the same central pair validator used by regular edits/imports and new Admin game creation. Existing unplayed matchups rebuild empty inning templates only when teams change; booking-only changes preserve saved templates and metadata.

The transaction holds the existing active-season advisory lock and stable ordered match row locks. Scoring locks are read in a separate statement **after** row locks are acquired, so an umpire lock obtained while a save waited cannot be missed by an older statement snapshot. Revision/protection validation and final conflict checks precede all writes. Imported teams are provisioned before any game references them; unused proposed CSV teams are omitted. Updated/imported game rows and save/import receipts commit together or roll back together.

Deterministic import draft IDs survive preview refreshes. Durable receipt keys allow committed-but-lost-response retries without duplicating games or repeating existing-game updates. Original CSV receipts contain the resolved booking/team names. No new endpoint, schema migration, environment variable or Production operation is required for this feature.

## Verification

Automated PostgreSQL coverage includes cage/team overlaps, multiple and chained affected games, stale/simultaneous saves, archived/unauthorized mutations, protected/scored/forfeited games, scoring-field rejection, an umpire-lock race, new-game validation, matchup templates, unused import teams, cancellation/preflight, exact retry behavior and rollback after a later import insert fails.

Transport regressions reject malformed successful confirmations, preserve server refresh details, bound hanging requests and retain the retry identifier. Existing scoring, ownership, recovery, statistics and UI suites remain required.

`tests/browser/conflictResolutionWorkflow.py` runs the actual UI and API handlers against guarded localhost PostgreSQL. It covers immediate highlighting, editable neighboring games, chained discovery, read-only finals, whole-season checks despite filters, stale edit recovery, Cancel, new-game lost-response retry and mobile multi-row CSV resolution. Existing 48-game import/edit/rename/remove and scoring workflows are also exercised.

To reproduce locally, run the guarded test server/CSS build described in `tests/browser/README.md`, using `dugout_test_admin_browser`, then:

```sh
DUGOUT_BROWSER_DATABASE_URL=postgres://dugout_test@127.0.0.1:55432/dugout_test_admin_browser node tests/browser/setup.mjs
DUGOUT_BROWSER_DATABASE_URL=postgres://dugout_test@127.0.0.1:55432/dugout_test_admin_browser node tests/browser/conflictResolutionSetup.mjs
python3 tests/browser/conflictResolutionWorkflow.py
```

The setup scripts refuse cloud endpoints. Browser/device checks in a protected deployed Preview still require the owner's normal login. Desktop Chromium is not certification of physical Android Firefox behavior. Keep this feature in Preview until owner acceptance; PR #11's existing identity-migration prerequisite still applies to the combined Admin release.

Concurrent whole/partial imports are covered separately in `tests/browser/importConcurrencyWorkflow.py`: a CSV row already created on another screen is reconciled to its real game/team IDs, local booking edits remain visible, and the admin can continue without creating duplicates or losing edits. Saved import receipts are distinguished from this form's own lost-response receipt; another person's import is never treated as confirmation that this form's existing-game edits were saved. The request accepts up to 5,000 affected bookings so a 1,000-row CSV can also resolve existing calendar entries.
