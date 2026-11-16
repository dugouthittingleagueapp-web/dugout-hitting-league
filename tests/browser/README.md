# Schedule browser regression

Runs the actual app and API handlers against a disposable **localhost** PostgreSQL
DB. No production or Preview Neon credentials are needed. The test server refuses
any host except 127.0.0.1 and any database name except `dugout_test_browser`.
It serves a local-only test sign-in route; never deploy this test server.

Prerequisites: Node dependencies, a local PostgreSQL server with an empty database
named `dugout_test_browser`, Python Playwright and Chromium at `/usr/bin/chromium`.
The setup script resets synthetic data in that local test database.

From the repository root (adjust only the local port/user):

```sh
export DUGOUT_BROWSER_DATABASE_URL=postgres://dugout_test@127.0.0.1:55432/dugout_test_browser
node tests/browser/setup.mjs
npx --yes tailwindcss@3.4.17 -c tests/browser/tailwind.config.cjs -i index.css -o work/schedule-browser.css
npx vite --config tests/browser/vite.config.ts
```

In a second terminal:

```sh
python3 tests/browser/scheduleWorkflow.py
```

CSS is compiled locally for the test to avoid depending on the app's external
Tailwind CDN. No frontend or database safety setting is changed to support tests.
Screenshots go to `work/browser/`.

Coverage: 48-game CSV import; missing destination blocks Import; archived Dashboard
selection does not affect active Schedule; new league creation; team rename;
invalid edit rejected; notes/cage survive save/reopen; repeated import after rename
creates no copy; remove cancel/confirm; refresh; mobile file upload and editable
controls; updated league and team names visible from the league dashboard.

For real PostgreSQL API/transaction regressions, set `DUGOUT_TEST_DATABASE_URL` to
another disposable localhost database named `dugout_test_*` and run `npm test`.
Those tests create their own schema and never read `DATABASE_URL`. GitHub CI
provides its own PostgreSQL service and runs these tests on every PR build.

## Critical scoring fault regression

Create a separate localhost database named `dugout_test_scoring_browser`, then:

```sh
export DUGOUT_BROWSER_DATABASE_URL=postgres://dugout_test@127.0.0.1:55432/dugout_test_scoring_browser
node tests/browser/scoringSafetySetup.mjs
npx vite --config tests/browser/vite.config.ts
```

The same local CSS prerequisite applies. This test server selects port **3400**.
In a second terminal run `python3 -u tests/browser/scoringSafetyWorkflow.py`.
Fixture creation adds fresh synthetic games; it does not delete existing records.
Never expose the local test-session route or run this server as a deployment.

Coverage: real UI/API/database behavior under hanging requests, lost responses,
unavailable storage, offline refresh, missing tab token, stale profile reads,
copied tabs, all 5/3/1 extra rounds, mobile 15th pitch, failed finalization and a
finished umpire game with a retained recovery copy. The unit/PostgreSQL suite
additionally covers malformed requests, rollback, substitutions, undo and forfeits.
Playwright may log route-cancellation warnings when navigation deliberately
interrupts a held request; application page errors are collected separately and
fail the workflow.
