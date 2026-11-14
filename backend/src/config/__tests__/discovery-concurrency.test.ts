/**
 * Multi-region PR 1 (A1): the region pool and the resource pool are read from one
 * place, with bounds: unset -> default; not a whole number -> default (warned);
 * outside the bounds -> clamped (warned). The deadlines stay under the lease's hour.
 */
import {
  REGION_DEADLINE_MS,
  REGION_POOL,
  RESOURCE_POOL,
  SCAN_BUDGET_MS,
  readDiscoveryConcurrency,
  readPoolSize,
} from '../discovery-concurrency';
import { MAX_LEASE_AGE_SECONDS } from '../../services/scan-lease';
import { DEFAULT_AWS_CALL_POLICY } from '../../utils/awsCallPolicy';

describe('discovery pool sizes', () => {
  it('defaults: region pool 3, resource pool 8 (what discovery has always used)', () => {
    expect(readDiscoveryConcurrency({})).toEqual({ regionPool: 3, resourcePool: 8 });
    expect(DEFAULT_AWS_CALL_POLICY.concurrency).toBe(RESOURCE_POOL.default);
  });

  it('reads both from the environment', () => {
    expect(readDiscoveryConcurrency({ DISCOVERY_REGION_POOL: '2', DISCOVERY_RESOURCE_POOL: '4' })).toEqual({ regionPool: 2, resourcePool: 4 });
  });

  it.each([
    ['0', REGION_POOL.min],
    ['-3', REGION_POOL.min],
    ['99', REGION_POOL.max],
  ])('an out-of-range region pool %s is clamped to %s, with one warning', (raw, expected) => {
    const warn = jest.fn();
    expect(readPoolSize('DISCOVERY_REGION_POOL', raw, REGION_POOL, warn)).toBe(expected);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('DISCOVERY_REGION_POOL');
  });

  it.each(['three', '2.5', '1e3', ' ', ''])('a region pool that is not a whole number (%p) is the default', (raw) => {
    const warn = jest.fn();
    expect(readPoolSize('DISCOVERY_REGION_POOL', raw, REGION_POOL, warn)).toBe(REGION_POOL.default);
    expect(warn).toHaveBeenCalledTimes(raw.trim() === '' ? 0 : 1);
  });

  it('the resource pool is bounded too', () => {
    const warn = jest.fn();
    expect(readPoolSize('DISCOVERY_RESOURCE_POOL', '1000', RESOURCE_POOL, warn)).toBe(RESOURCE_POOL.max);
    expect(readPoolSize('DISCOVERY_RESOURCE_POOL', '0', RESOURCE_POOL, warn)).toBe(RESOURCE_POOL.min);
  });

  it('the region deadline (10 min) and scan budget (45 min) stay under the lease\'s one-hour age (MR-D3)', () => {
    expect(REGION_DEADLINE_MS).toBe(10 * 60_000);
    expect(SCAN_BUDGET_MS).toBe(45 * 60_000);
    expect(SCAN_BUDGET_MS + REGION_DEADLINE_MS).toBeLessThan(MAX_LEASE_AGE_SECONDS * 1000);
  });
});
