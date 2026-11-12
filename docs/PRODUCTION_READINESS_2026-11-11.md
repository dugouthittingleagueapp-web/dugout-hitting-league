# Dugout Hitting League — pre-merge security and environment audit
Date: 2026-11-11 (America/New_York)

## Scope
- Read-only inspection of Vercel environment variable **metadata** and Neon branches.
- Read-only inspection of whether admin and umpire credentials exist and are bcrypt hashed; no password values were extracted.
- Code changes and tests only on `refactor/network-and-sync-foundation`.
- **No** GitHub merge, Production configuration change, database mutation, data copy, or Preview-to-Production data transfer.

## Verified
- `api/settings.ts` no longer defaults to the known `admin` / `umpire` passwords.
- `api/migrations.ts` requires explicitly configured initial passwords when first provisioning a missing credential; existing database rows remain untouched.
- Legacy plaintext password upgrade remains for existing explicitly configured credentials.
- Environment recovery authentication does not replace an existing password with the recovery password.
- Neon branches are distinct: Production `br-twilight-king-a4joutf2` and development Preview `br-bold-resonance-a431str6`.
- A **read-only** query showed both branches already have configured bcrypt-hashed `admin_password` and `umpire_password` records.
- GitHub CI for commit `d6c5af4043df711f8292f38643f062fd35e391e8` passed TypeScript, automated tests and Vite build (run `43144827892`).

## Release blockers / verification needed
1. **Production SESSION_SECRET:** No Production-targeted `SESSION_SECRET` appears in current Vercel project environment variable metadata. The new authentication code requires a deployment-specific server-only secret of at least 32 characters. Configure **a distinct Production secret** *before* merging. This is a Production settings change and requires explicit user approval.
2. **Runtime database mapping:** `api/db.ts` uses `DATABASE_URL` first, then `POSTGRES_URL`. Both are supplied by a Vercel/Neon integration as encrypted values covering multiple environments. A separate mixed-case key `Database_url` exists for Production and this Preview branch, but **it is not read by the code**. Metadata plus Neon branch existence cannot prove which endpoint a particular Vercel deployment actually resolves at runtime. Verify that the *effective* Production `DATABASE_URL` resolves to the Production branch and Preview resolves to the Preview branch before merging or accepting writes. Never copy Preview records.
3. **Manual Preview regression:** After the latest Preview deployment is ready, verify admin login, umpire login, an ordinary official game finalization, read-only umpire View of finalized game, Fan Mode live updates, and offline scoring/reconnect. Prior user testing covered these flows before the latest login changes; the latest deployment still deserves a final smoke test.
4. **Release approval:** Do not merge `refactor/network-and-sync-foundation` into `main` until the user explicitly authorizes it.

## Deliberately deferred
- The existing full-match PUT and offline queue are untouched; a per-pitch API would be a separate high-risk project.
- No password rotation or invalidation of current users' sessions.
- No change to Fan Mode polling (10 seconds) or dashboard polling (30 seconds).
- No Preview data transfer, data migration, or historical-statistics rewrite.
