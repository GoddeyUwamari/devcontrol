/**
 * Walks an Express 4 app's router stack and reports, for every route, the
 * effective method and full path and every function that runs before its
 * handler, in registration order. Used by route-auth-inventory.test.ts to
 * decide whether authentication runs before each handler, by function
 * identity.
 *
 * Express 4 keeps only a compiled RegExp for a use() mount path, so
 * installMountPathRecorder() wraps Router#use to store the literal path on
 * every layer it creates. It must run before the app's modules are loaded.
 * Anything the walker cannot model is reported as unsupported, which fails the
 * inventory, never skipped: a non-string path, a sub-app (mounted on the app
 * or on any router), a router.param/app.param callback (it runs before a
 * route's own middleware), or a layer created before the recorder was
 * installed.
 *
 * What "protected" means, and what it does NOT cover: `authenticate` is
 * somewhere in the chain before the route's final handler. It does not check
 * that nothing ahead of `authenticate` sends a response -- middleware placed
 * before it that answers the request (or a plain middleware that ends every
 * request, express.static-style) is not detected. A router hidden behind a
 * wrapper function (`(req, res, next) => router(req, res, next)`) looks like
 * plain middleware, so its routes are invisible to the walk.
 */
import express from 'express';
import type { PublicRoute, RouteFunction } from '../../config/public-routes';

const MOUNT_PATH = Symbol('mountPath');
const HAS_SUB_APP = Symbol('hasSubApp');

export interface WalkedRoute {
  method: string;
  path: string;
  /** Every function that runs before the handler: app/router middleware whose mount covers the path, then the route's own middleware. */
  chain: RouteFunction[];
  handler: RouteFunction;
  /** The router that registered the route and its full mount path; one router mounted twice is two families. */
  family: string;
}

export interface Walk {
  routes: WalkedRoute[];
  unsupported: string[];
}

let installed = false;

export function installMountPathRecorder(): void {
  if (installed) return;
  installed = true;

  const routerProto = express.Router as any;
  const originalUse = routerProto.use;
  routerProto.use = function recordingUse(this: any, ...args: any[]) {
    // Same rule Express uses to decide whether the first argument is a path.
    let path: unknown = '/';
    let first = args[0];
    while (Array.isArray(first) && first.length !== 0) first = first[0];
    if (typeof first !== 'function') path = args[0];

    const before = this.stack.length;
    const result = originalUse.apply(this, args);
    for (const layer of this.stack.slice(before)) layer[MOUNT_PATH] = path;
    return result;
  };

  const appProto = (express as any).application;
  const originalAppUse = appProto.use;
  appProto.use = function recordingAppUse(this: any, ...args: any[]) {
    for (const arg of args.flat(Infinity)) {
      if (isApp(arg)) this[HAS_SUB_APP] = true;
    }
    return originalAppUse.apply(this, args);
  };
}

export function joinPath(...parts: string[]): string {
  const joined = parts.join('/').replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : '/';
}

/**
 * Whether every request for `path` enters middleware mounted at `prefix`.
 * Only a param in the prefix matches any segment: a route's own `:id` does not
 * match a literal mount, since `/x/intelligence` middleware never runs for
 * `/x/123`.
 */
function covers(prefix: string, path: string): boolean {
  if (prefix === '/') return true;
  const want = prefix.split('/').filter(Boolean);
  const have = path.split('/').filter(Boolean);
  if (have.length < want.length) return false;
  return want.every((seg, i) => seg.startsWith(':') || seg === have[i]);
}

function isApp(handle: any): boolean {
  return !!handle && typeof handle.handle === 'function' && typeof handle.set === 'function';
}

function isRouter(handle: unknown): boolean {
  return typeof handle === 'function' && Object.getPrototypeOf(handle) === express.Router;
}

export function walkApp(app: any): Walk {
  if (!installed) throw new Error('installMountPathRecorder() must run before the app is built');
  const routes: WalkedRoute[] = [];
  const unsupported: string[] = [];
  if (app[HAS_SUB_APP]) unsupported.push('a sub-app is mounted with app.use()');
  // Middleware seen so far, with the full path it is mounted under. A nested
  // router's own middleware stays here after the walk leaves it: Express runs
  // it for every later request that enters that router's prefix, including
  // ones a later sibling router then handles.
  const seen: { fn: RouteFunction; prefix: string }[] = [];

  let mounts = 0;
  const walk = (router: any, prefix: string, family: string) => {
    const params = Object.keys(router.params ?? {});
    if (params.length > 0) unsupported.push(`param callback for ${params.map(p => `:${p}`).join(', ')} under ${prefix}`);
    for (const layer of router.stack) {
      if (layer.route) {
        const route = layer.route;
        if (typeof route.path !== 'string') {
          unsupported.push(`route with a non-string path under ${prefix}`);
          continue;
        }
        const path = joinPath(prefix, route.path);
        for (const method of Object.keys(route.methods).filter(m => route.methods[m])) {
          const handles = route.stack
            .filter((l: any) => l.method === undefined || (method !== '_all' && l.method === method))
            .map((l: any) => l.handle);
          const before = seen.filter(s => covers(s.prefix, path)).map(s => s.fn);
          routes.push({
            method: method === '_all' ? 'ALL' : method.toUpperCase(),
            path,
            chain: [...before, ...handles.slice(0, -1)],
            handler: handles[handles.length - 1],
            family,
          });
        }
        continue;
      }

      const mount = layer[MOUNT_PATH];
      if (typeof mount !== 'string') {
        unsupported.push(`middleware "${layer.name}" under ${prefix} has a ${mount === undefined ? 'missing' : 'non-string'} mount path`);
        continue;
      }
      const scope = joinPath(prefix, mount);
      if (isApp(layer.handle)) {
        unsupported.push(`sub-app mounted under ${scope}`);
      } else if (isRouter(layer.handle)) {
        walk(layer.handle, scope, `${scope} #${++mounts}`);
      } else {
        seen.push({ fn: layer.handle, prefix: scope });
      }
    }
  };

  app.lazyrouter?.();
  walk(app._router, '/', '/ #0');
  return { routes, unsupported };
}

export function isProtected(route: WalkedRoute, authentication: ReadonlySet<RouteFunction>): boolean {
  return route.chain.some(fn => authentication.has(fn));
}

/** Every way the walked routes and the allowlist disagree; empty when they agree. */
export function checkInventory(
  walk: Walk,
  allowlist: readonly PublicRoute[],
  authentication: ReadonlySet<RouteFunction>,
): string[] {
  const problems = walk.unsupported.map(u => `unsupported registration: ${u}`);
  const key = (method: string, path: string) => `${method} ${path}`;

  const entries = new Map<string, PublicRoute>();
  for (const entry of allowlist) {
    const k = key(entry.method, entry.path);
    if (entries.has(k)) problems.push(`duplicate allowlist entry: ${k}`);
    entries.set(k, entry);
  }

  const matched = new Set<string>();
  for (const route of walk.routes) {
    const k = key(route.method, route.path);
    const entry = entries.get(k);
    if (entry) matched.add(k);

    if (isProtected(route, authentication)) {
      if (entry) problems.push(`${k} is allowlisted but authenticated; remove its allowlist entry`);
      continue;
    }
    if (!entry) {
      problems.push(`${k} runs without authentication and is not in config/public-routes.ts; add authenticate before its handler or a reviewed allowlist entry`);
      continue;
    }
    if (entry.type !== 'public' && ![...route.chain, route.handler].includes(entry.guard)) {
      problems.push(`${k} is allowlisted as "${entry.type}" but its expected guard is not in the route's chain`);
    }
  }

  for (const k of entries.keys()) {
    if (!matched.has(k)) problems.push(`stale allowlist entry: ${k} matches no route`);
  }
  return problems;
}
