# Schedule conflict protection

Admin CSV preview, CSV commit and scheduled-game editing check the same booking
rules. The checks compare every official game in the active season across all
leagues. Practice games are excluded.

- A tunnel pair cannot hold overlapping games on the same calendar date.
- A team cannot play overlapping games, even in different tunnels or with its
  home/away assignment reversed. Team IDs are used, not names.
- Partial overlaps and contained intervals count as conflicts. End/start times
  may touch: 6–7 and 7–8 are permitted without a required turnover gap.
- Exact duplicate imports remain skipped. Conflicts are checked only for games
  that would actually be added. Existing successful-import receipts remain safe
  to retry after renaming teams or editing games.
- Import failures show CSV row numbers, teams, leagues, dates, times and tunnels.
  Commit rejects the whole import before creating leagues, teams, games or its
  receipt. Feedback is bounded to 50 conflict descriptions.
- Edits exclude the edited game itself and retain its revision, metadata and
  innings if rejected. Existing finalized/scored/scoring-owned game protections
  run before any edit.
- Missing start/end times in an existing relevant booking require admin review;
  the checker does not guess when that game finishes.

Preview and commit recheck the current saved schedule inside the existing
active-season advisory-lock transaction. Concurrent imports, concurrent edits
and import/edit races cannot both claim the same slot through these endpoints.
No schema migration or database exclusion constraint was added. Older generic
match-writing endpoints are not redesigned by this change; these protections
apply to Admin Schedule import/edit operations.

Validation: 429 automated tests in 56 files passed, including 14 interval/identity
checks and 30 real PostgreSQL schedule integration tests. TypeScript and build
passed. The local Chromium 48-game workflow passed conflict feedback, blocked
Import, conflicting edit rejection, valid correction and existing schedule,
rename, removal, mobile and league-dashboard regressions. Deployed Preview
acceptance uses fresh synthetic records only; Production is not promoted.
