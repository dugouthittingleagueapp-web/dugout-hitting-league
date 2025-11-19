import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Required for Node.js environments (like Vercel Serverless) to handle WebSockets
neonConfig.webSocketConstructor = ws;

// Helper to determine if a string is valid (not just whitespace)
const isValid = (str: string | undefined) => str && str.trim().length > 0;

// 1. Get the raw string. We strictly check if process.env.DATABASE_URL has content. 
// If it's an empty string (common env config error), we skip it and use the fallback.
let rawConnectionString = isValid(process.env.DATABASE_URL) 
  ? process.env.DATABASE_URL 
  : "postgres://neondb_owner:npg_qFK0WsorA4Jm@ep-late-glitter-a44vvx23-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";

if (!rawConnectionString) {
  throw new Error('DATABASE_URL is missing and no fallback is configured.');
}

// 2. Sanitize: Remove 'psql ' prefix, quotes, whitespace
let connectionString = rawConnectionString!
  .replace(/^psql\s+/, '')
  .replace(/['"]/g, '')
  .trim();

// 3. Ensure protocol is postgres:// (fix potential postgresql:// parsing issues in some drivers)
if (connectionString.startsWith('postgresql://')) {
  connectionString = connectionString.replace('postgresql://', 'postgres://');
}

console.log(`DB Connection initialized with: ${connectionString.substring(0, 25)}...`); // Log partial key for debug

const pool = new Pool({
  connectionString
});

// Error handling for the pool to prevent server crashes on idle connection loss
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export default pool;