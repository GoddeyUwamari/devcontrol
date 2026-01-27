/**
 * Database Migration Runner
 * Runs PostgreSQL migration scripts in order
 *
 * Usage: node database/migrate.js
 *
 * Environment Variables:
 * - DB_HOST: Database host (default: localhost)
 * - DB_PORT: Database port (default: 5432)
 * - DB_NAME: Database name (default: platform_portal)
 * - DB_USER: Database user (default: postgres)
 * - DB_PASSWORD: Database password
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected to database');

    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Get list of already executed migrations
    const executedMigrations = await client.query(
      'SELECT migration_name FROM schema_migrations ORDER BY migration_name'
    );
    const executedSet = new Set(executedMigrations.rows.map(row => row.migration_name));

    // Read all migration files from the migrations directory
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql') && !file.includes('GUIDE') && !file.includes('rollback'))
      .sort();

    console.log(`\n📁 Found ${files.length} migration files`);

    let executed = 0;
    let skipped = 0;

    for (const file of files) {
      if (executedSet.has(file)) {
        console.log(`⏭️  Skipping ${file} (already executed)`);
        skipped++;
        continue;
      }

      const migrationPath = path.join(migrationsDir, file);
      console.log(`\n🚀 Running migration: ${file}`);

      const sql = fs.readFileSync(migrationPath, 'utf8');

      try {
        // Run the migration in a transaction
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (migration_name) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');

        console.log(`✅ Migration ${file} completed successfully`);
        executed++;
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Migration ${file} failed:`, error.message);
        throw error;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log(`   ✅ Executed: ${executed}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   📁 Total: ${files.length}`);
    console.log('='.repeat(60));

    if (executed > 0) {
      console.log('\n✨ Database schema is now up to date!');
    } else {
      console.log('\n✨ Database schema was already up to date!');
    }
  } catch (error) {
    console.error('\n❌ Migration process failed:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    throw error;
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

// Run migrations
runMigrations().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
