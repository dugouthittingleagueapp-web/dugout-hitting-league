
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

console.log(`[DB] Initializing Pool. Connection String Length: ${connString.length}`);

if (!connString) {
  console.error("[DB] CRITICAL: No DATABASE_URL found in environment variables.");
}

// 3. Initialize Pool
const pool = new pg.Pool({
  connectionString: connString,
  ssl: {
    rejectUnauthorized: false // Required for Neon/Vercel connections
  },
  connectionTimeoutMillis: 5000, // Fail fast if cannot connect
});

// 4. Error Handling
pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client', err);
});

export default pool;
