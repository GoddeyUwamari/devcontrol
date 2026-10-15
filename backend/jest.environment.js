/**
 * Node test environment that closes the pg pools a test file left open
 * (recorded by jest.setup-pools.js). It runs after every one of the file's
 * hooks, including its own afterAll cleanup, so nothing a test still needs
 * is closed early. end() is not awaited: it closes idle connections at once,
 * and a client a test never released is closed when released rather than
 * hanging the worker.
 */
const { TestEnvironment } = require('jest-environment-node');

class PoolClosingEnvironment extends TestEnvironment {
  async teardown() {
    for (const pool of this.global.__jestOpenPgPools || []) {
      if (pool.ending) continue;
      pool.end().catch((error) => {
        console.warn('[jest] closing a pg pool the test file left open failed:', error);
      });
    }
    await super.teardown();
  }
}

module.exports = PoolClosingEnvironment;
