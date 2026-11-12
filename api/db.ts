import pg from 'pg';
import { selectDatabaseConnectionString } from './databaseConnection.js';

// A deployed Vercel app must use its own environment-scoped Database_url.
// The selector rejects an accidental Preview-to-Production connection before
// database operations can run.
let connString = selectDatabaseConnectionString(process.env);

// Neon certificates and hostname must be verified, never bypassed.
const parsed = new URL(connString);
parsed.searchParams.set('sslmode', 'verify-full');
connString = parsed.toString();

const pool = new pg.Pool({
  connectionString: connString,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client', err);
});

export default pool;
