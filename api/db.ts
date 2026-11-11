
import pg from 'pg';

// 1. Get the connection string from env
let connString = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

// 2. Sanitize the string (Fixes "Invalid URL" errors caused by copy-pasting)
// Remove leading/trailing whitespace
connString = connString.trim();
// Remove surrounding quotes if they exist (common .env mistake)
if ((connString.startsWith('"') && connString.endsWith('"')) || 
    (connString.startsWith("'") && connString.endsWith("'"))) {
  connString = connString.slice(1, -1);
}

if (!connString) {
  console.error("[DB] CRITICAL: No DATABASE_URL found in environment variables.");
} else {
  // Neon connection URLs commonly specify sslmode=require. node-postgres
  // warns because its current meaning is verify-full but will change in a
  // future release. Explicitly require certificate AND hostname validation.
  // Do not use rejectUnauthorized:false, which disables that validation.
  const parsed = new URL(connString);
  parsed.searchParams.set('sslmode', 'verify-full');
  connString = parsed.toString();
}

// 3. Initialize Pool. The connection string supplies verified TLS settings.
const pool = new pg.Pool({
  connectionString: connString,
  connectionTimeoutMillis: 5000, // Fail fast if cannot connect
});

// 4. Error Handling
pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client', err);
});

export default pool;
