/**
 * Records every pg Pool a test file creates (the app pool in
 * config/database.ts and any pool the test builds itself), so
 * jest.environment.js can close the ones still open once the file is done.
 *
 * Why: each test file gets its own copy of config/database.ts, whose pool
 * (max 50) keeps idle connections for 30s after use. Most files never end
 * it, so a worker accumulated the idle connections of every file it had run
 * in the last 30s; at --maxWorkers=3 (CI) the suite peaked at 92-100 of
 * Postgres's default 100 connections and hit "sorry, too many clients
 * already" in unrelated suites.
 */
const pg = require('pg');

const pools = (globalThis.__jestOpenPgPools = globalThis.__jestOpenPgPools || []);
const BasePool = pg.Pool;

class RecordedPool extends BasePool {
  constructor(...args) {
    super(...args);
    pools.push(this);
  }
}

pg.Pool = RecordedPool;
