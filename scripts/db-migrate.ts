import { runMigrations } from '../api/migrations.js';

async function main() {
  console.log('[DB-MIGRATE] Checking and applying database migrations...');
  try {
    const result = await runMigrations();
    console.log(`[DB-MIGRATE] Complete. ${result.applied} migration(s) applied. Versions: ${result.versions.join(', ') || 'None (up to date)'}`);
    process.exit(0);
  } catch (err) {
    console.error('[DB-MIGRATE] Migration error:', err);
    process.exit(1);
  }
}

main();
