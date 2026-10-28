/**
 * Route auth inventory: every route the real app serves must either run
 * `authenticate` before its handler or be listed in config/public-routes.ts.
 *
 * The app is built by importing server.ts (which does not start under Jest),
 * then its router stack is walked in registration order; see
 * helpers/route-walker.ts. No server is started, no environment file is read
 * and nothing connects to Postgres or AWS.
 *
 * The walker's own rules are pinned by the self-tests at the bottom, on small
 * synthetic apps.
 */
import './helpers/record-mount-paths';
import express, { Request, Response, NextFunction } from 'express';
import { walkApp, checkInventory, isProtected, Walk } from './helpers/route-walker';
import app from '../server';
import { PUBLIC_ROUTES, PublicRoute, RouteFunction } from '../config/public-routes';
import { authenticate, authenticateToken } from '../middleware/auth.middleware';

// No .env: environment is whatever the runner provides.
jest.mock('../config/load-env', () => ({ loadEnv: jest.fn(), LOCAL_STACK_ENV_FILE: '/nonexistent' }));
jest.mock('../config/validateEnv', () => ({ validateEnv: jest.fn() }));
// Constructed at route import; its cache-cleanup interval would keep Jest alive.
jest.mock('../services/ai-insights.service', () => ({
  AIInsightsService: jest.fn().mockImplementation(() => ({})),
}));

const AUTHENTICATION: ReadonlySet<RouteFunction> = new Set([authenticate]);

describe('route auth inventory (real app)', () => {
  let walk: Walk;

  beforeAll(() => {
    walk = walkApp(app);
  });

  it('authenticateToken is the same function as authenticate', () => {
    expect(authenticateToken).toBe(authenticate);
  });

  it('walks the whole app', () => {
    expect(walk.unsupported).toEqual([]);
    expect(walk.routes.length).toBeGreaterThan(200);
  });

  it('every route is authenticated or on the reviewed allowlist, and every allowlist entry is live', () => {
    expect(checkInventory(walk, PUBLIC_ROUTES, AUTHENTICATION)).toEqual([]);
  });

  it('every allowlist entry gives a reason', () => {
    for (const entry of PUBLIC_ROUTES) expect(entry.reason.trim().length).toBeGreaterThan(10);
  });
});

// ─── Walker self-tests ───────────────────────────────────────────────────────

const auth = (_req: Request, _res: Response, next: NextFunction) => next();
const otherGuard = (_req: Request, _res: Response, next: NextFunction) => next();
const tokenGuard = (_req: Request, _res: Response, next: NextFunction) => next();
const handler = (_req: Request, res: Response) => { res.end(); };
const AUTH = new Set<RouteFunction>([auth]);

function routesOf(build: (app: express.Express) => void) {
  const synthetic = express();
  build(synthetic);
  const result = walkApp(synthetic);
  expect(result.unsupported).toEqual([]);
  return result;
}

function find(walk: Walk, method: string, path: string) {
  const route = walk.routes.find(r => r.method === method && r.path === path);
  if (!route) throw new Error(`walker did not report ${method} ${path}`);
  return route;
}

describe('route walker', () => {
  it('(a) router-wide auth registered before a route protects it', () => {
    const walk = routesOf(app => {
      const r = express.Router();
      r.use(auth);
      r.get('/x', handler);
      app.use('/api', r);
    });
    expect(isProtected(find(walk, 'GET', '/api/x'), AUTH)).toBe(true);
  });

  it('(b) router-wide auth registered after a route does not protect it, only later ones', () => {
    const walk = routesOf(app => {
      const r = express.Router();
      r.get('/before', handler);
      r.use(auth);
      r.get('/after', handler);
      app.use('/api', r);
    });
    expect(isProtected(find(walk, 'GET', '/api/before'), AUTH)).toBe(false);
    expect(isProtected(find(walk, 'GET', '/api/after'), AUTH)).toBe(true);
  });

  it('(c) per-route auth protects only when it runs before the handler', () => {
    const walk = routesOf(app => {
      app.get('/guarded', auth, handler);
      app.post('/guarded', handler, auth);
    });
    expect(isProtected(find(walk, 'GET', '/guarded'), AUTH)).toBe(true);
    expect(isProtected(find(walk, 'POST', '/guarded'), AUTH)).toBe(false);
  });

  it('(d) nested routers join their prefixes and inherit the parent router\'s auth', () => {
    const walk = routesOf(app => {
      const outer = express.Router();
      const inner = express.Router();
      inner.get('/c/:id', handler);
      outer.use(auth);
      outer.use('/b', inner);
      app.use('/a', outer);
    });
    expect(isProtected(find(walk, 'GET', '/a/b/c/:id'), AUTH)).toBe(true);
  });

  it('(e) a router mounted at a parent prefix runs its middleware for a later sibling under that prefix', () => {
    const walk = routesOf(app => {
      const parent = express.Router();
      parent.use(auth);
      parent.get('/', handler);
      const child = express.Router();
      child.get('/', handler);
      app.use('/p', parent);
      app.use('/p/q', child);
      app.use('/other', express.Router().get('/', handler));
    });
    expect(isProtected(find(walk, 'GET', '/p/q'), AUTH)).toBe(true);
    expect(isProtected(find(walk, 'GET', '/other'), AUTH)).toBe(false);
  });

  it('(f) a token entry passes only with its own guard in the chain', () => {
    const walk = routesOf(app => {
      app.get('/right', tokenGuard, handler);
      app.get('/wrong', otherGuard, handler);
    });
    const entry = (path: string): PublicRoute =>
      ({ method: 'GET', path, type: 'token', guard: tokenGuard, category: 'integration', reason: 'self-test entry' });
    expect(checkInventory(walk, [entry('/right'), entry('/wrong')], AUTH)).toEqual([
      'GET /wrong is allowlisted as "token" but its expected guard is not in the route\'s chain',
    ]);
  });

  it('(g) an allowlist entry that matches no route is reported as stale; an unlisted public route fails', () => {
    const walk = routesOf(app => {
      app.get('/open', handler);
    });
    const gone: PublicRoute = { method: 'GET', path: '/gone', type: 'public', category: 'operational', reason: 'self-test entry' };
    expect(checkInventory(walk, [gone], AUTH)).toEqual([
      'GET /open runs without authentication and is not in config/public-routes.ts; add authenticate before its handler or a reviewed allowlist entry',
      'stale allowlist entry: GET /gone matches no route',
    ]);
  });

  it('(h) router.route() with several methods reports each method with its own chain', () => {
    const walk = routesOf(app => {
      app.route('/multi').get(handler).post(auth, handler);
    });
    expect(isProtected(find(walk, 'GET', '/multi'), AUTH)).toBe(false);
    expect(isProtected(find(walk, 'POST', '/multi'), AUTH)).toBe(true);
  });

  it('(i) a registration the walker cannot model is reported, not skipped', () => {
    const synthetic = express();
    synthetic.get(/^\/regex$/, handler);
    synthetic.use(['/a', '/b'], express.Router().get('/', handler));
    const { unsupported } = walkApp(synthetic);
    expect(unsupported).toEqual([
      'route with a non-string path under /',
      'middleware "router" under / has a non-string mount path',
    ]);
  });
});
