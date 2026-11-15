/**
 * How much of a discovery scan runs at once, and how long it may run (multi-region
 * PR 1, amendment A1/A2). The one place these values are read.
 *
 *   region pool      regions scanned at the same time by a multi-region scan
 *                    (organization flag multi_region_discovery on). Default 3.
 *   resource pool    per-resource units of work (one instance's backup lookup, one
 *                    bucket's checks) at the same time, within one region. Default 8,
 *                    the value discovery has always used (utils/awsCallPolicy.ts).
 *
 * Both can be set by environment variable for an operator, never by a customer:
 * DISCOVERY_REGION_POOL and DISCOVERY_RESOURCE_POOL. A value that is not a whole
 * number is ignored (the default is used); a whole number outside the bounds is
 * clamped to the nearest bound. Either way one warning names the variable and the
 * value used, never anything else.
 *
 * The deadlines are fixed (A2, PR 1b review M-2, founder decision Nov 14), all
 * measured from the scan lease's acquisition:
 *
 *   0 ............ 30 min   regions may start (SCAN_BUDGET_MS); the rest get scan_budget
 *   start + 10 min          a region that started stops (REGION_DEADLINE_MS, region_deadline),
 *                           and never later than the scan deadline
 *   30 + 10 = 40 .. 50 min  at least 10 minutes for the steps after the regions
 *                           (IAM, compliance, orphans, cost)
 *   50 min                  the scan deadline (SCAN_DEADLINE_MS): no post-region step
 *                           starts after it, and one still running is stopped (its AWS
 *                           calls are aborted). The job still completes, with the
 *                           warning scan_deadline: never failed for time alone, never
 *                           "another scan took over".
 *   50 .. 60 min            the final writes (sources, the job row)
 *   60 min                  the scan lease's age limit (scan-lease.ts MAX_LEASE_AGE_SECONDS)
 *
 * They apply to a multi-region scan only; a scan without the flag is unchanged.
 */

export interface PoolBounds {
  default: number;
  min: number;
  max: number;
}

export const REGION_POOL: PoolBounds = { default: 3, min: 1, max: 6 };
export const RESOURCE_POOL: PoolBounds = { default: 8, min: 1, max: 16 };

/** How long a region that started may run before it is stopped as region_deadline. */
export const REGION_DEADLINE_MS = 10 * 60 * 1000;
/** After this long, a multi-region scan starts no new region (the rest get scan_budget). Was 45 min before PR 1b (M-2). */
export const SCAN_BUDGET_MS = 30 * 60 * 1000;

/**
 * The whole multi-region scan's deadline (PR 1b, review M-2): after it no step after
 * the regions starts, and one still running is stopped. Leaves FINAL_WRITE_RESERVE_MS
 * for the final writes before the lease's age limit.
 */
export const SCAN_DEADLINE_MS = 50 * 60 * 1000;

/** Time kept for the steps after the regions: SCAN_DEADLINE_MS - (SCAN_BUDGET_MS + REGION_DEADLINE_MS). */
export const POST_REGION_RESERVE_MS = 10 * 60 * 1000;

/** Time kept after the scan deadline for the final writes, before the lease's 60-minute age limit. */
export const FINAL_WRITE_RESERVE_MS = 10 * 60 * 1000;

/**
 * How many of one multi-region scan's region database steps hold a pool connection
 * at the same time (multi-region PR 1b, review M-1). A region worker holds no
 * connection while it waits on AWS; each database step checks one out and returns
 * it. One: the regions' steps take turns, so a flagged scan never holds more than
 * one connection beyond its own (and a manual Sync's request connection).
 */
export const REGION_DB_STEP_CONNECTIONS = 1;

/**
 * The throttle breaker (Step 1 §A2): every THROTTLE_BREAKER_STEP throttled calls in
 * one region halve that region's resource pool, never below THROTTLE_BREAKER_FLOOR.
 * The region slows down; it is never stopped for being throttled.
 */
export const THROTTLE_BREAKER_STEP = 5;
export const THROTTLE_BREAKER_FLOOR = 2;

export interface DiscoveryConcurrency {
  regionPool: number;
  resourcePool: number;
}

/** One pool size from its variable: the default when unset or not a whole number, clamped to the bounds otherwise. */
export function readPoolSize(name: string, raw: string | undefined, bounds: PoolBounds, warn: (message: string) => void = console.warn): number {
  if (raw === undefined || raw.trim() === '') return bounds.default;
  if (!/^-?\d+$/.test(raw.trim())) {
    warn(`[discovery-concurrency] ${name} is not a whole number; using the default ${bounds.default}`);
    return bounds.default;
  }
  const value = Number(raw.trim());
  if (value < bounds.min || value > bounds.max) {
    const clamped = Math.min(bounds.max, Math.max(bounds.min, value));
    warn(`[discovery-concurrency] ${name}=${value} is outside ${bounds.min}..${bounds.max}; using ${clamped}`);
    return clamped;
  }
  return value;
}

/** Both pool sizes, read from the environment (see the module comment). */
export function readDiscoveryConcurrency(env: NodeJS.ProcessEnv = process.env, warn?: (message: string) => void): DiscoveryConcurrency {
  return {
    regionPool: readPoolSize('DISCOVERY_REGION_POOL', env.DISCOVERY_REGION_POOL, REGION_POOL, warn),
    resourcePool: readPoolSize('DISCOVERY_RESOURCE_POOL', env.DISCOVERY_RESOURCE_POOL, RESOURCE_POOL, warn),
  };
}

/** Read once per process, when first used. */
let cached: DiscoveryConcurrency | undefined;
export function discoveryConcurrency(): DiscoveryConcurrency {
  cached ??= readDiscoveryConcurrency();
  return cached;
}
