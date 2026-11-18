/**
 * Backend test files that change the database schema, so they run on their
 * own after the parallel suite, one file at a time (jest.serial.config.js),
 * and are left out of the parallel run (jest.parallel.config.js).
 *
 * Why: CI runs every other test file in parallel workers against ONE
 * Postgres database. A file that applies or rolls back a migration, or runs
 * ALTER/CREATE/DROP, takes strong locks (AccessExclusiveLock) on tables other
 * files are writing at the same moment. Postgres then sometimes finds a lock
 * cycle and kills one side with "deadlock detected" -- e.g. on 2026-11-17
 * demo-workspace-foundation-migration's rollback waited for AccessExclusiveLock
 * on a table while another file's INSERT / DELETE waited on a table the
 * rollback already held. Run alone, nothing else holds those locks.
 *
 * A file belongs here when it executes, against the shared database, any of:
 * a migration or rollback file, the migration runner (runMigrations), or
 * CREATE/ALTER/DROP/COMMENT on tables, schemas, functions, triggers, policies
 * or indexes -- even inside a transaction it rolls back, and even in a schema
 * of its own. NOT here: TEMP tables only; roles and GRANT/REVOKE only (they
 * take no table lock); ensureSharedFixtureTable() (CREATE TABLE IF NOT
 * EXISTS under an advisory lock, never dropped).
 *
 * Paths are relative to backend/. Each one must exist: a renamed or deleted
 * file fails both configs at load instead of silently dropping out of the
 * serial run.
 */
const fs = require('fs');
const path = require('path');

const SERIAL_TEST_FILES = [
  'src/__tests__/job-demo-exclusion.test.ts',
  'src/controllers/__tests__/newsletter-subscribe.test.ts',
  'src/repositories/__tests__/framework-evaluations.repository.test.ts',
  'src/repositories/__tests__/weekly-summary-we2-reads.db.test.ts',
  'src/routes/__tests__/services-coverage.test.ts',
  'src/services/__tests__/anomaly-rules-rls-migration.test.ts',
  'src/services/__tests__/aws-connection-checks-home-region-proposal-migration.test.ts',
  'src/services/__tests__/aws-connection-checks-migration.test.ts',
  'src/services/__tests__/aws-disconnect-expand-migration.test.ts',
  'src/services/__tests__/aws-org-external-ids-migration.test.ts',
  'src/services/__tests__/check-compatibility.test.ts',
  'src/services/__tests__/checkout-reservation-migration.test.ts',
  'src/services/__tests__/compliance-framework-security-foundation-migration.test.ts',
  'src/services/__tests__/custom-anomaly-rules.service.test.ts',
  'src/services/__tests__/deactivate-published-default-admin-migration.test.ts',
  'src/services/__tests__/demo-workspace-foundation-migration.test.ts',
  'src/services/__tests__/drop-auto-detect-resource-ownership-migration.test.ts',
  'src/services/__tests__/framework-evaluation-persistence-migration.test.ts',
  'src/services/__tests__/harden-database-ownership-migration.test.ts',
  'src/services/__tests__/m5a-region-list.test.ts',
  'src/services/__tests__/m5b-region-scan-status.test.ts',
  'src/services/__tests__/migrate-runner.test.ts',
  'src/services/__tests__/multi-region-scan-foundation-migration.test.ts',
  'src/services/__tests__/optimization-rule-config.service.test.ts',
  'src/services/__tests__/resource-health-evaluations-migration.test.ts',
  'src/services/__tests__/resource-telemetry-observations-migration.test.ts',
  'src/services/__tests__/scan-lease.test.ts',
  'src/services/__tests__/slo.service.test.ts',
  'src/services/__tests__/transfer-tenant-table-ownership-migration.test.ts',
  'src/services/__tests__/trial-migration.test.ts',
  'src/services/__tests__/users-previous-login-at-migration.test.ts',
];

const duplicates = SERIAL_TEST_FILES.filter((file, i) => SERIAL_TEST_FILES.indexOf(file) !== i);
if (duplicates.length > 0) throw new Error(`jest.serial-files.js lists a file twice: ${duplicates.join(', ')}`);
const missing = SERIAL_TEST_FILES.filter((file) => !fs.existsSync(path.join(__dirname, file)));
if (missing.length > 0) throw new Error(`jest.serial-files.js lists files that do not exist: ${missing.join(', ')}`);

module.exports = { SERIAL_TEST_FILES };
