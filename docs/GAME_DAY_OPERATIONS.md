# Game-day operations implementation and migration plan

Dedicated branch: `feature/game-day-operations`, based on Admin Preview
`a37a6d35b0510f9f974a15780d3a1b4cfae89da2`. Production inspected read-only:
`778ef94584096ebde90911d539b90f33e06ae2b3`, READY deployment
`dpl_GDfxkpXU5fQLjTUJEMrFH65syotw`. This branch contains that baseline;
unmerged PR #11 supplies schedule conflict resolution and player identities.
Do not merge older experimental atomic-sync branches over the released protocol.

## Stages

1. Verify central calendar validation and close legacy match-route bypasses.
   Preserve ad-hoc scoring entry and historical score corrections.
2. Read-only, on-demand readiness using shared calendar and scoring validation.
   Today uses America/New_York. Weekly lineup confirmation is advisory;
   substitutes and fewer regulars remain supported by the existing scoring rules.
3. Add bounded, allowlisted diagnostic events and admin history/export. Errors
   are best effort and never prerequisites for scoring. No scoring snapshots,
   names, ownership tokens, secrets or arbitrary error messages are stored.
4. Add separate authenticated database/scoring health probes and diagnostic
   summaries; unknown/unreported device state must remain explicit.

Use existing API functions to remain inside the Vercel function limit.
No polling while the dashboard is closed; manual refresh and reload on returning
from existing schedule/roster screens. Keep score acknowledgements, revisions,
journaling, conflict preservation and ownership semantics intact.

## Additive migration and rollback

Add only `diagnostic_events`, with bounded identifiers, fixed event categories,
server-generated timestamps, bounded summaries, severity/resolution, operation
and correlation IDs. Index recent time, game, league and unresolved events.
Avoid foreign-key cascades so deleting a synthetic game cannot erase history.
Deduplicate event retries and aggregate recurring errors within bounded windows.
Default retention is 90 days (configurable within documented bounds). Cleanup is
explicit, admin-authorized and batched; never runs on scoring writes. Export is
bounded/paginated and excludes sensitive data.

Apply the reviewed SQL first to a disposable local database and isolated Neon
Preview branch. Compare schemas and game/roster fingerprints before and after.
Production migration is a separate, explicitly approved release step. The
existing PR #11 player-identity migration remains a separate prerequisite.
Rollback: restore previous application code; retain the additive table/history.
No down migration, game rewrite, historical repair or data deletion is required.
Missing/unavailable diagnostics must show unavailable, never healthy.

## Validation and release

Run all existing tests with disposable PostgreSQL, TypeScript, build and actual
browser flows. Add regression coverage for readiness, legacy schedule bypasses,
auth, health failure/timeout, redaction, deduplication, retention and nonblocking
logging. Test existing offline/ownership/finalization flows after integration.
Preview acceptance is distinct from automated checks. Do not deploy Production,
merge main, change Production settings or write Production data.
