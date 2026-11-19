# Permanent player identities — isolated Admin Preview

Each person has a UUID in `league_players`. `player_identity_links` connects every existing roster/game player ID to that person. Existing team JSON, innings, extra innings, pitches, game status and revisions are not rewritten. Deploying the code never runs a migration or guesses identities.

Career entry points now pass player IDs, including weekly leaders, rosters, regulation scoring and extra innings. Career aggregation resolves only the explicit identity links. Names and initials are never runtime join keys. Data-load failures show an error instead of incomplete career totals. Player-name corrections preserve the identity.

## One registration flow

Admin types a name normally. The roster form automatically shows possible previous-season players, with names, prior teams and seasons. It suggests common shortened names such as Mike/Michael and requires an explicit same-person or different-person answer when candidates exist. These aliases never trigger an automatic merge. Multiple people with the same name are separate candidates. The server recomputes/validates choices in the roster transaction, rejects forged or duplicate identities and retains the existing archive/scoring/ownership/stale-edit protections. Before Save, the admin can change their answer. Changing a name alone keeps its identity. The manual previous-player search remains available after saving, and can explicitly reconnect a saved entry to an older identity even if the names differ. Expected identity links reject a stale concurrent reassignment. A connected-history label shows the prior name/team/season after saving.

Other team/substitute entry points assign separate permanent identities marked for review. They never automatically join a returning player by name. Opening Admin Rosters provides the same confirmation workflow. Historical names remain available as search aliases; a name change does not break a verified link.

## Initial conversion

Only isolated Neon branch br-lively-unit-a4ag48fp / ep-bold-term-a4y8a4nu was changed. The additive migration creates the two identity tables and an index. A saved UUID assignment manifest was prepared from all Preview team rosters plus the immutable 2025 archive. It materializes clear existing display-name associations only when there is at most one distinct roster ID per season and no conflicting full last names. Ambiguous groups remain separate and unreviewed.

Preview conversion: 242 roster IDs, 234 permanent people, eight clear cross-season groups, 109 ambiguous entries in Preview test/archive data. No main 2026 roster entry was ambiguous. A comparison of the 51 main-season career entry points preserves their real associations: the only removed name-based association was real Dane with a newly inserted synthetic Preview test player named Dane Test. Test fixtures are separate people. Existing tables are guarded against changes between the read-only plan and conversion transaction. No Production connection or write was used.

The migration SQL is separate from the normal migration runner. A future Production release requires an explicitly approved Production mapping plan and additive schema application; do not simply promote this Preview or rerun a UUID generator over existing mappings. Archive rows and scored pitch IDs must remain unchanged.

## Validation

467 automated tests across 59 files passed, including real local PostgreSQL confirmation/rollback, duplicate/forged identity rejection, name changes, archive and role checks, scoring locks, and existing scoring regressions. TypeScript/build passed. Career-service tests join the correct seasons after a name change and exclude a different same-name player. Bootstrap tests cover same-season duplicates and ambiguous first-name-only records.

The mobile browser workflow tests real UI → API → isolated localhost PostgreSQL: two identical names from different prior teams/seasons, required confirmation, the selected person's actual career totals, rename stability, explicit different-person identity, and unchanged saved match rows.

Deployed authenticated acceptance still requires the owner's normal Preview login: the old local synthetic signing key was rejected by this branch. Do not rotate Preview or Production credentials merely to run acceptance. Public identity-directory reads use GET /api/teams?identityDirectory=1 and can be verified without admin access. The read was consolidated into the existing Teams API after Vercel rejected an additional function under the current 12-function plan limit; no hosting or Production settings were changed. Keep PR #11 in draft and Production unchanged.

Additional coverage: shortened names, explicit manual connections between different names, connecting a member after it has been saved, stale identity-choice rejection, and retaining fuller permanent names when a returning member is entered with first name/initials alone.

Reproduce identity browser checks in a fresh disposable local `dugout_test_admin_browser` database: set DUGOUT_BROWSER_DATABASE_URL, run tests/browser/setup.mjs, rosterSetup.mjs, then playerIdentitySetup.mjs. Start the local test API using tests/browser/vite.config.ts with DUGOUT_BROWSER_PORT=4100 and generate Tailwind CSS per tests/browser/README.md. Run tests/browser/playerIdentityWorkflow.py. These setup scripts reject Neon connections. They reset only the explicitly guarded local test database.

## Name autofill on confirmed history selection

Selecting “Yes, same player” now fills the row's First name and Last name from that permanent player's record while retaining the row ID and selected identity decision. This applies to new teams, added members/substitutes and manual connections on already saved roster entries. The roster still requires Save; selecting a candidate does not write immediately.

Validation: 493 automated tests in 61 files and TypeScript/build passed. Mobile Chromium checks against actual localhost APIs and disposable PostgreSQL verify nickname/last-initial replacement, both-field autofill for an already-saved different name, unchanged roster IDs, persisted names/identity links, unchanged historical pitches and career totals, and new-team matching from empty name fields. No database migration, cloud data write, credential change or Production action is involved.
