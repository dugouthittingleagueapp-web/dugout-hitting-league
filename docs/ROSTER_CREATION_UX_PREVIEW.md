# Cleaner roster entry — Preview only

The normal task is now one form: choose the league, enter a team name and three players, confirm returning players as they appear, then Create team. Names stay side by side on mobile and desktop with readable text and touch-sized inputs.

## Interface behavior

- During creation, league and team name share the main form. Changing the league preserves all entered names and draft IDs. The irrelevant existing-team selector and duplicate Create button are hidden.
- Three compact player rows are present immediately. Automatic prior-player suggestions remain in the name-entry flow. Yes, same player still fills both name fields and retains the selected permanent identity.
- Confirmed matches collapse to a compact summary including league/year context. Change reopens the picker with the current name already searched; Done closes it without clearing the decision. Choosing a match returns keyboard focus to the player's name.
- Manual history search is optional behind Find previous, including after saving when a connection needs correction. Player moves and removal of unsaved rows are under a native keyboard-accessible Options disclosure. Stored members still cannot be removed through these controls.
- Substitutes are optional and get rows only when added. No disabled Add player control is shown once all three slots exist.
- An imported empty team offers Set up three players once, rather than three separate Add operations.
- The primary save action stays within reach while scrolling. Missing identity confirmations are brought into view. Blank forms can be canceled without a discard warning; meaningful drafts retain the existing leave/refresh protections. A name-only duplicate draft can open the existing team directly.

No player identity rules, backend mutations, authorization, scoring behavior, historical records, schema, credentials or environment configuration were changed.

## Verification

497 automated tests in 61 files pass with disposable PostgreSQL enabled; TypeScript/build pass. Actual local mobile/desktop browser → API → PostgreSQL workflows verify three-player creation, field layout, initially focused team-name entry, blank cancel, collapsed/optional tools, substitute additions, safe timeout/lost-response retries, immediate offline lookup, imported roster setup, existing-team reuse, later schedule selection, saved identity names/IDs/career history, reopening/closing a match without losing its selection, player moves through Options, stale editor rejection, failed-save draft retention and same-name teams in different leagues. Changing a new team's league retains the draft and saves under the correct league.

Screenshots: work/browser/clean-roster-create-mobile.png and work/browser/clean-roster-create-desktop.png. Browser test fixtures are localhost-only. Authenticated deployed Preview acceptance and physical-device testing remain separate from local browser verification.

React review: normal escaped text/controlled inputs, stable player UUID keys, event-driven disclosure state, retained dirty/save guards and explicit focus handling. No new client requests, dependencies or database/API changes are added.

The branch remains fix/schedule-import-league-provisioning, draft PR #11, pinned to the existing isolated Preview database. All testing uses synthetic local data; no cloud records or Production data/settings/deployment are modified. Next acceptance: use the protected Preview to create a three-player team including a returning player, then check an optional substitute and Options without touching live games.
