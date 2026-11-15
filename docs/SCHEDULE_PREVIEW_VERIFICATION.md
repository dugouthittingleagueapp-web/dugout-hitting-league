# Schedule Preview implementation and verification

Branch: `fix/schedule-import-league-provisioning`, PR #11. Preview only.
No production deployment, production configuration, Neon data mutation or schema
migration was performed to implement or verify this work.

## Design

- `utils/schedulePolicy.ts` is the shared UI/API rule for genuinely unplayed games.
  Finished games, recorded zeroes, malformed legacy scores and tie-breaker data are
  protected. Before changing/removing game rows, the server also checks for an
  open scoring session under the same match row lock used by scoring.
- `withActiveSeason` checks the server's active season and holds it stable for the
  transaction. Import, league/team provisioning, rename, move and league deletion
  share a transaction advisory lock, so their checks cannot race their writes.
  Existing pitch-save and offline-recovery paths retain their established rules.
- POST `/api/schedule-admin` handles preflight and import through the same planner.
  The complete CSV is validated before three bulk inserts. A failure rolls back
  leagues, teams, games and the import receipt together.
- Receipts use the existing `app_settings` table. Retrying the same CSV/destination
  is safe after a lost response or team rename. A repeated file does not resurrect
  games intentionally removed afterward. The UI explains that it was already imported.
- Duplicate matching retains the established rule: same league, season, calendar
  date and team pairing, including reversed home/away. Practice games do not block
  an official import. Doubleheaders between the same teams on the same day would
  require a deliberate change to that existing rule.
- Explicit CSV-group mappings drive both preflight and save. Old/stale responses
  cannot enable Import for a different CSV or mapping. Invalid files and failed
  reads remain distinct from an empty schedule.
- Schedule reads only the active season's server data, independently of Dashboard's
  archived-year selection. Import refreshes the parent league list, and renames
  preserve team IDs/rosters while updating displays on subsequent screen loads.

## Automated verification

`npm ci`, `npm run build` and the full `npm test` suite are required.
A native Node ESM loading test also emits the server modules without bundling
and imports them with no database credentials, catching deployment-only module
resolution errors that Vite/Vitest can otherwise hide.

Set `DUGOUT_TEST_DATABASE_URL` to a disposable **localhost** database named
`dugout_test_*` to include PostgreSQL integration tests. The tests refuse remote
hosts and never use `DATABASE_URL`. CI creates its own PostgreSQL 17 service.

Integration coverage includes:
- preflight has zero writes; complete import; multi-group mapping; in-file duplicates;
- rollback after a deliberately failed final insert, including the receipt;
- simultaneous imports; lost-response retry after rename;
- archived-season rejection through Schedule and the older creation/deletion APIs;
- unauthenticated/umpire rejection of schedule administration;
- legacy SCHEDULED records with numeric zero or malformed string results;
- edit/reload notes, stale revisions, simultaneous name collisions;
- protection of finished records and unchanged numerical standings;
- game creation racing league deletion without orphaned records;
- scoring locks and stale-score rejection after schedule operations.

The lockfile repair restores missing platform-specific optional package entries;
versions of previously locked dependencies remain unchanged.

## Browser verification

See `tests/browser/README.md` for the guarded local server and regression runner.
The full app, real API handlers and disposable PostgreSQL were exercised with a
48-game synthetic season at desktop and 390px mobile sizes. File upload, mapping,
import, rename, notes/cage edits, safe retry, cancel/remove, refresh, and navigation
to the updated league dashboard were verified. A mobile footer overlap found by
this test was corrected and re-tested.

No real game was started, finalized, removed or altered during verification.
Before any separately approved production release, repeat the owner smoke test
on the authenticated Preview and the established real-device/offline scoring
checks. A passing local test is not a claim of exhaustive device coverage.
