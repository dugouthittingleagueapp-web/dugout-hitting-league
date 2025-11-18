import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_qFK0WsorA4Jm@ep-late-glitter-a44vvx23-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require';

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