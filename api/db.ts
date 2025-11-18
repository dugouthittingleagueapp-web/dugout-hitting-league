import pg from 'pg';
const { Pool } = pg;

// connectionString MUST be set in environment variables (Vercel Settings or .env file)
// Do not hardcode credentials here to prevent security leaks on GitHub
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is missing. Please configure it in Vercel or your .env file.');
}

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

// Error handling for the pool to prevent server crashes on idle connection loss
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export default pool;