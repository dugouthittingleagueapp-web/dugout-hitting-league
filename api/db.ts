import pg from 'pg';
import { selectDatabaseConnectionString } from '../server/databaseConnection.js';

// A deployed Vercel app must use its own environment-scoped Database_url.
// The selector rejects an accidental Preview-to-Production connection before
// database operations can run.
const isVercelDeployment = ['production', 'preview', 'development'].includes(process.env.VERCEL_ENV || '');
const hasLocalDatabaseUrl = !!(process.env.Database_url || process.env.DATABASE_URL || process.env.POSTGRES_URL);

// Some local unit tests import the migrations module without configuring a
// database. Preserve import-only tests while still failing closed in every
// deployed Vercel environment before any database operations can start.
let connString = (isVercelDeployment || hasLocalDatabaseUrl)
  ? selectDatabaseConnectionString(process.env)
  : '';

if (connString) {
  // Neon certificates and hostname must be verified, never bypassed.
  const parsed = new URL(connString);
  parsed.searchParams.set('sslmode', 'verify-full');
  connString = parsed.toString();
}

const pool = new pg.Pool({
  connectionString: connString || undefined,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client', err);
});

export default pool;
