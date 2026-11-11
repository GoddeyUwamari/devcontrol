/**
 * The UI's plan numbers (lib/plan/plan-limits.json, read by the plan catalog
 * that every pricing surface renders) equal what the server enforces:
 * resource and seat limits, resource types per plan, and the trial's length
 * and plans. Read with fs, as connect-policy-compare.test.ts reads the
 * frontend policy file (backend Jest can't import frontend TS).
 */
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../database', () => ({ pool: { query: jest.fn() } }));

import { TIER_LIMITS, SubscriptionTier } from '../../middleware/subscription.middleware';
import { TIER_RESOURCE_TYPES } from '../../services/awsResourceDiscovery';
import { TRIAL_PERIOD_DAYS } from '../trial';
import { SELF_SERVE_TIERS } from '../../services/stripe.service';

const LIMITS_FILE = path.resolve(__dirname, '../../../../lib/plan/plan-limits.json');
const limits = JSON.parse(fs.readFileSync(LIMITS_FILE, 'utf8'));
const TIERS: SubscriptionTier[] = ['free', 'starter', 'pro', 'enterprise'];
const unlimitedAsNull = (n: number) => (n === -1 ? null : n);

describe('plan catalog numbers = server limits', () => {
  it.each(TIERS)('%s: monitored resources', (tier) => {
    expect(limits.resources[tier]).toBe(unlimitedAsNull(TIER_LIMITS[tier].maxResources));
  });

  it.each(TIERS)('%s: team members', (tier) => {
    expect(limits.teamMembers[tier]).toBe(unlimitedAsNull(TIER_LIMITS[tier].maxUsers));
  });

  it.each(TIERS)('%s: resource types', (tier) => {
    expect(limits.resourceTypes[tier]).toBe(TIER_RESOURCE_TYPES[tier].length);
  });

  it('trial length and plans', () => {
    expect(limits.trial.days).toBe(TRIAL_PERIOD_DAYS);
    expect(limits.trial.plans).toEqual([...SELF_SERVE_TIERS]);
  });

  it('annual prices are the canonical ones the server documents ("2 months free")', () => {
    // stripe.service.ts PRICE_ENV_VAR_CANDIDATES comment: $490.00/year and $1,990.00/year.
    expect(limits.prices.starter).toEqual({ monthly: 49, annual: 490 });
    expect(limits.prices.pro).toEqual({ monthly: 199, annual: 1990 });
    expect(limits.prices.starter.annual).toBe(limits.prices.starter.monthly * 10);
    expect(limits.prices.pro.annual).toBe(limits.prices.pro.monthly * 10);
  });
});
