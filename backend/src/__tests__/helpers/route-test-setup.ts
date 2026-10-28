/**
 * Import first in the route-auth tests, before the app or anything that
 * builds a router or reads config:
 *  - sets dummy JWT_SECRET / ENCRYPTION_KEY (the ci.yml values), so each file
 *    also runs alone;
 *  - installs the walker's mount-path recorder (see route-walker.ts);
 *  - makes every pg Pool's connect() and query() reject and record the call,
 *    from before the app is imported, so database access at import time is
 *    seen as well as during a request.
 */
import { Pool } from 'pg';
import { installMountPathRecorder } from './route-walker';

process.env.JWT_SECRET = 'ci-test-jwt-secret-not-a-real-secret-32c';
process.env.ENCRYPTION_KEY = 'ci-test-encryption-key-32-chars.';

installMountPathRecorder();

// jest.setup-pools.js subclasses Pool; spy where the methods are defined, so
// every pool is covered whichever class created it.
function definingPrototype(key: 'connect' | 'query'): any {
  let proto = Pool.prototype;
  while (proto && !Object.prototype.hasOwnProperty.call(proto, key)) proto = Object.getPrototypeOf(proto);
  return proto;
}

const touched = () => Promise.reject(new Error('the database was touched'));
export const dbConnect = jest.spyOn(definingPrototype('connect'), 'connect').mockImplementation(touched);
export const dbQuery = jest.spyOn(definingPrototype('query'), 'query').mockImplementation(touched);
