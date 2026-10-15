/**
 * Node test environment that closes the pg pools a test file left open
 * (recorded by jest.setup-pools.js). It runs after every one of the file's
 * hooks, including its own afterAll cleanup, so nothing a test still needs
 * is closed early. end() is not awaited: it closes idle connections at once,
 * and a client a test never released is closed when released rather than
 * hanging the worker.
 */
const path = require('path');
const { TestEnvironment } = require('jest-environment-node');

class PoolClosingEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    this.testPath = path.relative(config.projectConfig.rootDir, context.testPath);
  }

  async teardown() {
    let closed = 0;
    for (const pool of this.global.__jestOpenPgPools || []) {
      if (pool.ending) continue;
      closed += 1;
      pool.end().catch((error) => {
        process.stderr.write(`[jest pools] ${this.testPath}: closing a pg pool it left open failed: ${error}\n`);
      });
    }
    // Logged, never failed: how many pools this file left for teardown to close.
    if (closed > 0) process.stderr.write(`[jest pools] ${this.testPath}: closed ${closed} pg pool(s) left open\n`);
    await super.teardown();
  }
}

module.exports = PoolClosingEnvironment;
