# Same team names across leagues and years — Preview only

A team can be called Eagles in both 9U and 11U without putting age groups into its saved name. Team UUIDs identify records; name matching for creation/import is scoped to the active season and destination league. Roster and Schedule editing already filter by the selected league, and mixed-league schedule/rename/move screens already show league context.

This update adds the missing context to returning-player suggestions and connected-history labels: Eagles · 9U (2026), Eagles · 11U (2026). Searching previous players includes the league. Historical memberships are retained by team ID rather than collapsed by equal name/year, so two leagues remain visible even for a person who played in both. The added history fields are optional for compatibility with existing clients/fixtures.

The CSV preview counts teams by normalized league plus name: Eagles and Panthers in two leagues are four teams. Two CSV groups mapped into one destination league still count a matching name once. No age-group suffix is added to the stored team name.

Bulk moves reject a duplicate name within the destination league, including a batch containing two same-name teams from separate leagues. This protection runs in the existing serialized transaction before updates. Other normal moves retain existing behavior and scoring protections.

## Verification

497 tests in 61 files pass with disposable localhost PostgreSQL enabled; TypeScript/build pass. New regressions verify same-name teams across leagues/years, scoped CSV reuse, independent roster/rename operations, preservation of all game rows, retained historical league memberships, display labels, and rollback of conflicting moves.

Actual mobile Chromium → API → disposable PostgreSQL checks create Eagles in 9U and 11U, import two games against same-named Panthers, confirm the four-team preview count, verify correct team IDs and league-filtered game choices, and save one roster while proving the other team and every game remain unchanged. Previous-player choices distinguish same-name Alex players from Eagles in each league; selected identities and automatic name filling remain correct. The existing identity/autofill/career browser workflow also passes.

React review: labels use normal escaped text, existing UUID keys and controlled inputs remain intact, derived team counts add no state/effects, imports remain direct, and no dependencies or additional client requests are added.

## Release safety and acceptance

Only fix/schedule-import-league-provisioning and its isolated Preview environment are in scope. No migrations, environment/credential changes, cloud database writes, Production deployment or merge are performed. All test fixtures are localhost-only and preserve the owner's cloud league deletions.

Next: in Preview, create a test Eagles roster in each of two leagues, switch between them to confirm the right players, and import rows mapped to their respective leagues. Existing previous-player suggestions now include league and season without requiring a second administrative action. Deployed authenticated mutation acceptance remains with the owner's normal protected Preview login.
