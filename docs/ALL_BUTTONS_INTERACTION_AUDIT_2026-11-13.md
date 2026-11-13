# Dugout — full clickable-control audit (rehearsal Preview, Nov 13 2026)

**Scope:** Every current React TSX screen: App, admin dashboard, navigation, match setup, scoring display, score input, lineup editor, team management, practice setup, player career modal, match statistics editor, schedule and roster import, file dropzone, and operational guide.

**Static inventory:** 15 TSX files; **192** JSX buttons, **17** dropdowns, and **3** forms. Every button has an `onClick` handler or is explicitly a form submit. Every dropdown has `onChange`. Every form has `onSubmit`. This is enforced by `tests/ui/allControlsWired.test.ts` and is a source-code check, **not a claim that 192 browser clicks succeeded**.

## Verified source wiring and safe regression checks
- **Admin:** Start Practice, Guide (dialog portal), Exit Admin (league selection), year selector, archive management, division create/delete, team move, password updates, schedule import, JSON export. Guide and Exit are above overlay controls.
- **Admin practice:** The admin has no current league. A new mandatory dropdown now selects among season leagues; teams reload for the chosen league and Home/Away are reset. The league dashboard continues to bypass this selection using its known league. Backend rehearsal database has eight teams each in the two 2026 divisions.
- **Umpire scoring:** Score buttons, undo, inning selectors, lineup, tie breaker, reset (practice only), Save & Exit, Exit & Finalize, connection retry, completion/reopening controls. The score/status and offline/revision tests remain in the consolidated foundation.
- **Lineups and teams:** Move up/down, remove/add/replace players and substitutes, team select/edit/delete, Save, Save & Start. Disabled state guards remain.
- **Imports and editing:** CSV/paste/photo roster imports, schedule imports, stats remapping, confirmation/cancel actions, modal close actions and guide printing.
- **Navigation:** Login/logout, league selection, season selector, home/admin nav, mobile menu and theme changes.
- **Documentation fix:** Practice games are not auto-deleted on exit. Setup instructions now say they remain on the schedule until manually deleted.

## Limits that require a real browser/device test
Source code review does not prove every button receives pointer events, every handler completes under real network conditions, or every modal works at every screen size. Especially test: admin Guide/Exit; new practice league picker; save/undo/finalize; concurrent two-umpire access; airplane-mode reconnect; mobile menu; import file selection, print and downloads. Do not mark these as browser-verified until observed.

## Security/release safety
This audit is confined to `review/rehearsal-scoring-nov13` and the isolated Neon branch `br-mute-tooth-a4eathjt`. Do not merge this draft PR into `main`, deploy/promote Production, or apply schema changes to the Production Neon branch. Match data created in the rehearsal database are test-only.
