# Phase 2 local browser regression

Requires installed npm dependencies, Chromium, Python Playwright and disposable local PostgreSQL. No cloud database or deployment is used. The seed scripts and test server reject a database outside `127.0.0.1/dugout_test_phase2_browser`.

Create that empty disposable database on your local PostgreSQL server. Adjust only the localhost port below if necessary. All test fixtures use fresh identifiers; the scripts do not delete existing fixtures.

```sh
export DUGOUT_BROWSER_DATABASE_URL=postgres://dugout_test@127.0.0.1:55432/dugout_test_phase2_browser
node tests/browser/scoringSafetySetup.mjs
npm_config_cache=/tmp/dugout-npm-cache npx --yes tailwindcss@3.4.17 --config tests/browser/tailwind.config.cjs --input index.css --output work/schedule-browser.css
npx vite --config tests/browser/vite.config.ts
```

In a second terminal at the repository root with the same `DUGOUT_BROWSER_DATABASE_URL` exported, run each group in order. The server binds only localhost port 3700 and exposes test-session signing only in this test-specific configuration, outside the deployable API directory.

```sh
python3 -u tests/browser/gameDayReliabilityWorkflow.py
python3 -u tests/browser/startExtrasWorkflow.py
python3 -u tests/browser/statsEntryWorkflow.py
# The fault suite needs fresh games after the progression/retry checks.
node tests/browser/scoringSafetySetup.mjs
python3 -u tests/browser/scoringSafetyWorkflow.py
python3 -u tests/browser/scoringOperationsWorkflow.py
node tests/browser/lineupStartSetup.mjs
python3 -u tests/browser/lineupStartWorkflow.py
python3 -u tests/browser/scoringExitTakeoverWorkflow.py
```

The Phase 2 scripts check fan/read-only access, incomplete/valid extra rounds, direct API rejection without writes, one-click ownership recovery, finalized-game admin correction, and foreign-owner protection. Existing scripts check offline refresh/replay, lost responses, unavailable storage, stale copies, two-player formats, substitutions/undo, forfeit/finalization, scheduled entry and mobile exit/takeover.

The unchanged-source reproduction uses a separate local checkout of release `67ca29b` and port 3800, with the new regression tests copied into it. `statsEntryWorkflow.py` accepts `DUGOUT_PHASE2_BROWSER_BASE=http://127.0.0.1:3800` for that purpose; other origins are rejected.
