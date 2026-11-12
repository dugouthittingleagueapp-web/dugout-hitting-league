# Production scoring rollout — migration checklist (not yet executed)

This checklist covers the 2026-11-12 code review findings and does **not** authorize changes to Production. Run the schema migration only after the owner explicitly approves a maintenance window and Production database writes.

## What the read-only audit found

- Production Neon main branch: `br-twilight-king-a4joutf2`.
- Preview branch: `br-bold-resonance-a431str6`.
- Production currently has `matches`, but lacks `matches.revision` and the `scoring_locks` table.
- Preview already has these scoring concurrency structures.
- Neither branch had `schema_migrations` in the inspected public schema, so the general `db:migrate` script should **not** be run blindly against live Production. Its earlier migrations may alter unrelated legacy constraints or data.

## Prepared, minimal additive change

The standalone script `scripts/sql/production-scoring-upgrade.sql`:
1. Adds `matches.revision BIGINT NOT NULL DEFAULT 0` if missing.
2. Creates the `scoring_locks` table if missing.

It does not replace scores or recreate tables, has no mass UPDATE/DELETE, and is idempotent.

## Release order — each step is a separate gate

1. **Backup and recovery:** Confirm Neon point-in-time restoration is available for the Production main branch. Capture a verified point-in-time restore target or protected snapshot **before** schema changes. Do not repoint any live Vercel database URL.
2. **Rehearsal:** Create a *temporary isolated* Neon branch from the current Production main branch and execute the additive SQL only there. Check that `matches.revision` and `scoring_locks` exist, historical game counts are unchanged, and match reads still work. Dispose of the rehearsal branch after checks; do not copy data between Preview and Production.
3. **Explicit approval:** Obtain authorization to apply this small SQL upgrade to Production. This is not the same approval as reviewing or merging application code.
4. **Production schema:** Apply the reviewed SQL transaction to Neon Production `main`; confirm both objects, all preexisting matches, and zero unexpected records in `scoring_locks`.
5. **Application release:** Only after schema verification and separate merge approval, deploy the reviewed application code. Check that Production `Database_url` resolves to its own Neon endpoint, `SESSION_SECRET` is Production-only, and login/session creation works. Verify official-game read, scores, and archive.
6. **Rollback:** If the application encounters trouble, rollback the **application deployment** promptly. Leave the additive `revision` column and `scoring_locks` table intact (dropping them risks losing new scoring state). Restore Production database from backup only with separate explicit emergency authorization; never use Preview as a restore source.

## Guards in the new application code

- Once created, an official match cannot be marked practice (or vice versa) by a PUT.
- A scheduled match with any recorded pitch score (including zero), or tie-breaker data, requires the same scoring lock and revision checks as an in-progress match.
- Blank scheduled lineup changes remain supported.
- All writes use the per-match row lock; offline scoring preserves unacknowledged local snapshots.

## Before marking ready

- Full TypeScript check, Vitest and Vite build on the exact release commit.
- Vercel Preview READY on that same commit, with no function-limit errors.
- Verify manually in Preview: scheduled lineup edit, official/practice classification, scoring locks, Fan Mode, tie/ghost hitter, finalization, offline/reconnect.
- Never transfer Preview test games, teams, scores or records to Production.
