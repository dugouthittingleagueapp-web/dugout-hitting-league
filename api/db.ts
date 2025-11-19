import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Required for Node.js environments (like Vercel Serverless) to handle WebSockets
neonConfig.webSocketConstructor = ws;

// We check process.env first. If missing, we fall back to the provided Neon string.
// Note: In production, using process.env is more secure.
const rawConnectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_qFK0WsorA4Jm@ep-late-glitter-a44vvx23-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";

if (!rawConnectionString) {
  throw new Error('DATABASE_URL environment variable is missing.');
}

// Sanitize: Remove 'psql ' prefix if present, remove quotes, remove whitespace
const connectionString = rawConnectionString
  .replace(/^psql\s+/, '')
  .replace(/['"]/g, '')
  .trim();

const pool = new Pool({
  connectionString
});

// Error handling for the pool to prevent server crashes on idle connection loss
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export default pool;