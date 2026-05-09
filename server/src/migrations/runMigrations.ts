import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Use direct connection for migrations (pooler doesn't support DDL/PL pgSQL)
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const pool = new Pool({
  connectionString: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/**
 * Run database migrations with tracking
 * This script executes SQL migration files in order and tracks which have been run
 */
async function runMigrations() {
  // Create migrations tracking table if it doesn't exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrationsDir = path.join(__dirname);
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // Execute in alphabetical order

  // Ensure pgcrypto is available before any migration runs.
  // digest() from pgcrypto is used for SHA-256 content hashing in the files route.
  // CREATE EXTENSION IF NOT EXISTS is idempotent — safe to run even if already enabled.
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    console.log('✅ pgcrypto extension ready\n');
  } catch (extError: any) {
    // On managed Supabase instances this may throw if the role lacks SUPERUSER.
    // In that case pgcrypto is already pre-enabled by Supabase at the cluster level;
    // log the warning and continue — the extension will still be usable.
    console.warn(`⚠️  Could not run CREATE EXTENSION pgcrypto (may already be managed by Supabase): ${extError.message}\n`);
  }

  console.log('🔄 Running database migrations...\n');

  for (const file of migrationFiles) {
    // Check if migration has already been run
    const checkResult = await pool.query(
      'SELECT filename FROM schema_migrations WHERE filename = $1',
      [file]
    );

    if (checkResult.rows.length > 0) {
      console.log(`⏭️  Skipping ${file} (already executed)`);
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    try {
      console.log(`📝 Executing: ${file}`);
      await pool.query(sql);
      
      // Mark migration as executed
      await pool.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file]
      );
      
      console.log(`✅ Completed: ${file}\n`);
    } catch (error: any) {
      console.error(`❌ Error in ${file}:`, error.message);
      throw error;
    }
  }

  console.log('✅ All migrations completed successfully!');
}

// Run migrations if executed directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('\n🎉 Database is up to date');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration failed:', error);
      process.exit(1);
    });
}

export default runMigrations;
