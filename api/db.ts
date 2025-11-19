import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Required for Node.js environments (like Vercel Serverless) to handle WebSockets
neonConfig.webSocketConstructor = ws;

// Your specific Neon connection string (Cleaned)
const FALLBACK_CONNECTION_STRING = "postgres://neondb_owner:npg_qFK0WsorA4Jm@ep-late-glitter-a44vvx23-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";

// Logic: Use the Env Var if it exists and is not empty. Otherwise, use the Fallback.
const envUrl = process.env.DATABASE_URL;
const hasEnvUrl = envUrl && envUrl.trim().length > 0;

let connectionString = hasEnvUrl ? envUrl! : FALLBACK_CONNECTION_STRING;

// Sanitize: Remove 'psql ' prefix, quotes, whitespace which often get pasted in by accident
connectionString = connectionString
  .replace(/^psql\s+/, '')
  .replace(/['"]/g, '')
  .trim();

// Ensure protocol is postgres:// (fix potential postgresql:// parsing issues in some drivers)
if (connectionString.startsWith('postgresql://')) {
  connectionString = connectionString.replace('postgresql://', 'postgres://');
}

// Debug Log (This will show up in Vercel Logs)
console.log(`[DB] Initializing Pool. Using Fallback? ${!hasEnvUrl}. Connection string len: ${connectionString.length}`);

if (!connectionString) {
  throw new Error("CRITICAL: Connection string could not be determined.");
}

const pool = new Pool({
  connectionString
});

// Error handling for the pool to prevent server crashes on idle connection loss
pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client', err);
});

export default pool;