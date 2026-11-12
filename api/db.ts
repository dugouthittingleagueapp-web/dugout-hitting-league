import pg from 'pg';

// Prefer the Vercel/Neon DATABASE_URL; keep POSTGRES_URL for legacy deployments.
const configuredUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!configuredUrl?.trim()) {
  throw new Error('[DB] Database connection is not configured.');
}

const cleanedUrl = configuredUrl.trim().replace(/^(['"])(.*)\1$/, '$2');
const databaseUrl = new URL(cleanedUrl);

// Explicit certificate + hostname verification. Avoid ssl: { rejectUnauthorized: false },
// which can disable identity verification depending on the connection-string options.
databaseUrl.searchParams.delete('uselibpqcompat');
databaseUrl.searchParams.set('sslmode', 'verify-full');

const pool = new pg.Pool({
  connectionString: databaseUrl.toString(),
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // Do not emit the connection string or credentials.
  console.error('[DB] Unexpected error on idle client:', err.message);
});

export default pool;
