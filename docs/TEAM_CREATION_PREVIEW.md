# Team creation and schedule integration — Preview only

Admin Dashboard → Rosters → choose a league → Create team saves a team, two or three members, optional substitutes, and permanent player identities in one transaction. Returning-player suggestions and later manual identity connections use the same roster form. A stable team UUID makes retrying a committed save whose response was lost safe. Conflicting payloads and concurrent same-name creations are rejected without partial identities or teams.

## Import order

- Team first: the importer reuses the existing team when its trimmed, case-insensitive name, league and active season match. It retains the team ID, roster, substitutes and player identities.
- Schedule first: unknown teams are created with empty rosters instead of fabricated players. Rosters marks them "roster needed". Saving their real members initializes completely empty official scheduled-game lineups. Two-player ghost pitch counts are recalculated for both sides. Nonempty selected lineups, recorded pitches, practice games, status and completion flags stay protected. Only initialized game revisions increment.
- Team added later: it appears in Schedule → Edit for its league. Changing an unplayed matchup rebuilds the blank inning templates with the chosen teams' real roster IDs.
- CSV import adds games and skips duplicates. It does not rewrite existing matchups. Same-cage or same-team overlapping games are rejected against the season's existing calendar across leagues. Use Schedule → Edit for replacement matchups; adjacent slots remain allowed. Legacy games without parseable time bounds cannot be checked for overlap.

## Verification

484 tests in 60 files pass against disposable localhost PostgreSQL, including pre/post-import creation, empty-lineup initialization, same-name and import/create races, committed-response retry, returning-player/substitute identities, archive/role/ownership protection, conflicting imports with unchanged rows, and missing-roster scoring rejection. TypeScript and production build pass. The existing scoring regression suite remains included.

Chromium browser verification uses the actual UI → API → disposable localhost PostgreSQL: mobile create/save, lost response after commit and safe retry, CSV import preserving an existing roster, filling an empty imported roster, duplicate-name guidance, and selecting a newly created team in Schedule Edit. Existing 48-game Schedule and roster editing workflows are also checked. These local checks are distinct from authenticated acceptance on the protected Vercel Preview.

## Isolation

Branch: fix/schedule-import-league-provisioning; draft PR #11. Pinned isolated Neon branch: br-lively-unit-a4ag48fp / ep-bold-term-a4y8a4nu. This change requires no further migration or credential/settings changes. No Production writes, merge or deployment are authorized.

The owner deleted Preview leagues during testing; those deletions are preserved. A new empty league named "Roster Workflow Test — 2027-11-18" was added solely to the isolated Preview database. Before that addition, Preview had 13 leagues, 66 teams and 185 matches; the match fingerprint was be41d0192896aa6ed950b5e5cd98a432. Only the fresh league is intended to change in the cloud database during this work.

Next acceptance: log in normally to protected Preview, create a team and roster in that league, then import a synthetic CSV using the same team name. Confirm the roster persists. Import another team first, fill its roster, then create a third team and choose it in Schedule Edit. Do not use live game records for these checks. Keep this development work in Preview until separate Production approval.
