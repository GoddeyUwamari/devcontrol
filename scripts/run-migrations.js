#!/usr/bin/env node

/**
 * DEPRECATED — not the canonical migration runner.
 *
 * database/migrate.js is the canonical migration runner for this repository
 * (see database/migrations/README.md). This script has no migration-tracking
 * ledger of its own — it re-executes every file in database/migrations/ on
 * every invocation, relying entirely on each file's own idempotency, with no
 * record of what has already run and no checksum protection against a file
 * being edited after it was applied.
 *
 * Do not use this script for new deployments or migrations. It remains in
 * the repository pending an explicit future removal decision; no evidence
 * was found (as of the forensic migration audit) that it has ever been
 * wired into any deployment, CI/CD, or package script.
 *
 * Database Migration Runner (legacy, non-canonical)
 * Runs all SQL migrations in order
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const MIGRATIONS_DIR = path.join(__dirname, '../database/migrations');

async function runMigrations() {
  console.log('🚀 Starting database migrations...\n');

  try {
    // Get all migration files
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Run in alphabetical order (001, 002, 003, etc.)

    console.log(`Found ${files.length} migration files:\n`);

    for (const file of files) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`📝 Running migration: ${file}...`);

      try {
        await pool.query(sql);
        console.log(`✅ ${file} completed successfully\n`);
      } catch (error) {
        console.error(`❌ Error running ${file}:`);
        console.error(error.message);
        console.error('\nMigration failed. Please fix the error and try again.\n');
        process.exit(1);
      }
    }

    console.log('✅ All migrations completed successfully!\n');
  } catch (error) {
    console.error('❌ Migration error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migrations
runMigrations();
