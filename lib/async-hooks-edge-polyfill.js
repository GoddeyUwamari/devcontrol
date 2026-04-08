/**
 * Minimal AsyncLocalStorage polyfill for Vercel Edge Middleware.
 *
 * Vercel's Edge Middleware runtime does not expose `node:async_hooks`, so
 * Next.js's internal test-proxy module fails to initialise at the module
 * level and the middleware invocation is never reached (MIDDLEWARE_INVOCATION_FAILED).
 *
 * This stub satisfies the `new AsyncLocalStorage()` call that happens at
 * import time. All production code-paths that use the real implementation
 * are only reached when NEXT_PRIVATE_TEST_PROXY is set (never in prod).
 */

class AsyncLocalStorage {
  run(store, fn, ...args) {
    return fn(...args);
  }
  getStore() {
    return undefined;
  }
  enterWith() {}
  disable() {}
}

class AsyncResource {
  constructor(type) {
    this.type = type;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.apply(thisArg, args);
  }
  bind(fn) {
    return fn;
  }
  static bind(fn) {
    return fn;
  }
}

module.exports = { AsyncLocalStorage, AsyncResource };
