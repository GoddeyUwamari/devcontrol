/**
 * Fixture for route-auth-runtime.test.ts: a module that queries the database
 * when it is imported, to prove the test's database check sees import-time
 * access.
 */
import { pool } from '../../config/database';

pool.query('SELECT 1').catch(() => undefined);
