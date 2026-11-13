import pool from './db.js';
import { hashPassword } from './auth.js';
import { requiredInitialPassword } from '../server/passwordPolicy.js';

export interface Migration {
  version: number;
  name: string;
  up: (client: any) => Promise<void>;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: '001_core_tables',
    up: async (client) => {
      // 1. Leagues table with composite (id, season) key
      await client.query(`
        CREATE TABLE IF NOT EXISTS leagues (
          id TEXT NOT NULL,
          season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY'),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (id, season)
        );
      `);

      // 2. Teams table
      await client.query(`
        CREATE TABLE IF NOT EXISTS teams (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          league TEXT NOT NULL,
          players JSONB NOT NULL,
          subs JSONB DEFAULT '[]',
          season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY'),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // 3. Matches table with explicit is_practice column
      await client.query(`
        CREATE TABLE IF NOT EXISTS matches (
          id TEXT PRIMARY KEY,
          league TEXT NOT NULL,
          home_team_id TEXT NOT NULL,
          away_team_id TEXT NOT NULL,
          date TIMESTAMPTZ NOT NULL,
          is_complete BOOLEAN DEFAULT FALSE,
          status TEXT DEFAULT 'SCHEDULED',
          innings JSONB,
          tie_breaker JSONB,
          season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY'),
          location TEXT,
          start_time TEXT,
          end_time TEXT,
          notes TEXT,
          is_practice BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // 4. App settings table
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 2,
    name: '002_harden_practice_and_indexes',
    up: async (client) => {
      // Safely ensure columns exist across existing legacy tables
      await client.query(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY');`);
      await client.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY');`);
      await client.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS subs JSONB DEFAULT '[]';`);
      await client.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY');`);
      await client.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_practice BOOLEAN DEFAULT FALSE;`);

      // Upgrade existing NULL records to FALSE (strict official default)
      await client.query(`UPDATE matches SET is_practice = FALSE WHERE is_practice IS NULL;`);
      
      // Enforce NOT NULL and DEFAULT FALSE on is_practice
      try {
        await client.query(`ALTER TABLE matches ALTER COLUMN is_practice SET NOT NULL;`);
        await client.query(`ALTER TABLE matches ALTER COLUMN is_practice SET DEFAULT FALSE;`);
      } catch (e) {
        // Continue if already set
      }

      // Upgrade leagues primary key to composite (id, season) safely if legacy single-column pkey exists
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE table_name = 'leagues' AND constraint_type = 'PRIMARY KEY'
          ) THEN
            IF (SELECT count(*) FROM information_schema.key_column_usage WHERE table_name = 'leagues') = 1 THEN
              ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_league_fkey;
              ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_league_fkey;
              ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_pkey;
              ALTER TABLE leagues ADD PRIMARY KEY (id, season);
            END IF;
          END IF;
        END $$;
      `);

      // Performance & Integrity Indexes
      await client.query(`CREATE INDEX IF NOT EXISTS idx_matches_league_season ON matches (LOWER(league), season);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_matches_practice ON matches (is_practice);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_matches_complete ON matches (is_complete, status);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_matches_date_time ON matches (date ASC, start_time ASC);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_teams_league_season ON teams (LOWER(league), season);`);
    }
  },
  {
    version: 3,
    name: '003_secure_passwords_and_settings',
    up: async (client) => {
      const defaultYear = new Date().getFullYear().toString();
      await client.query(`INSERT INTO app_settings (key, value) VALUES ('current_season', $1) ON CONFLICT (key) DO NOTHING;`, [defaultYear]);

      // Migrate existing plaintext admin/umpire passwords to bcrypt hashes safely
      const adminRes = await client.query("SELECT value FROM app_settings WHERE key = 'admin_password';");
      const currentAdmin = adminRes.rows[0]?.value;
      if (!currentAdmin) {
        const initialHash = await hashPassword(requiredInitialPassword('admin', process.env.ADMIN_PASSWORD));
        await client.query("INSERT INTO app_settings (key, value) VALUES ('admin_password', $1);", [initialHash]);
      } else if (!/^\$2[aby]\$\d{2}\$/.test(currentAdmin)) {
        // Upgrade legacy plaintext to secure bcrypt hash
        const hashed = await hashPassword(currentAdmin);
        await client.query("UPDATE app_settings SET value = $1 WHERE key = 'admin_password';", [hashed]);
      }

      const umpireRes = await client.query("SELECT value FROM app_settings WHERE key = 'umpire_password';");
      const currentUmpire = umpireRes.rows[0]?.value;
      if (!currentUmpire) {
        const initialUmpireHash = await hashPassword(requiredInitialPassword('umpire', process.env.UMPIRE_PASSWORD));
        await client.query("INSERT INTO app_settings (key, value) VALUES ('umpire_password', $1);", [initialUmpireHash]);
      } else if (!/^\$2[aby]\$\d{2}\$/.test(currentUmpire)) {
        // Upgrade legacy plaintext to secure bcrypt hash
        const hashed = await hashPassword(currentUmpire);
        await client.query("UPDATE app_settings SET value = $1 WHERE key = 'umpire_password';", [hashed]);
      }
    }
  },
  {
    version: 4,
    name: '004_forfeit_columns',
    up: async (client) => {
      await client.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_forfeit BOOLEAN DEFAULT FALSE;`);
      await client.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS forfeiting_team_id TEXT;`);
      await client.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS forfeit_reason TEXT;`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_matches_forfeit ON matches (is_forfeit);`);
    }
  },
  {
    version: 5,
    name: '005_exclusive_scoring_locks',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS scoring_locks (
          match_id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    }
  },
  {
    version: 6,
    name: '006_match_revisions',
    up: async (client) => {
      await client.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;`);
    }
  }
];

/**
 * Runs pending migrations sequentially inside a transaction.
 * Tracks applied migrations in `schema_migrations`.
 */
export async function runMigrations(): Promise<{ applied: number; versions: number[] }> {
  const client = await pool.connect();
  const appliedVersions: number[] = [];

  try {
    // A live database may predate this migration runner. Creating an empty
    // history table and re-running every migration could change legacy data.
    // Require a reviewed, one-time baseline before any automatic updates.
    const history = await client.query(`
      SELECT to_regclass('public.schema_migrations') IS NOT NULL AS tracked,
             EXISTS (
               SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public'
                 AND table_name IN ('leagues', 'teams', 'matches', 'app_settings')
             ) AS existing_application
    `);
    if (!history.rows[0].tracked && history.rows[0].existing_application) {
      throw new Error(
        '[MIGRATIONS] Database already contains league data without migration history. ' +
        'Refusing automatic changes until a reviewed baseline is recorded.'
      );
    }

    // 1. Ensure migrations version table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Fetch already applied versions
    const { rows } = await client.query(`SELECT version FROM schema_migrations ORDER BY version ASC;`);
    const appliedSet = new Set<number>(rows.map(r => r.version));

    // 3. Execute pending migrations sequentially in transactions
    for (const migration of migrations) {
      if (!appliedSet.has(migration.version)) {
        console.log(`[MIGRATIONS] Applying migration ${migration.version}: ${migration.name}...`);
        await client.query('BEGIN');
        try {
          await migration.up(client);
          await client.query(
            `INSERT INTO schema_migrations (version, name) VALUES ($1, $2);`,
            [migration.version, migration.name]
          );
          await client.query('COMMIT');
          appliedVersions.push(migration.version);
          console.log(`[MIGRATIONS] Successfully applied migration ${migration.version}.`);
        } catch (mErr) {
          await client.query('ROLLBACK');
          console.error(`[MIGRATIONS] Failed to apply migration ${migration.version}: ${migration.name}`, mErr);
          throw mErr;
        }
      }
    }

    return { applied: appliedVersions.length, versions: appliedVersions };
  } finally {
    client.release();
  }
}
