/**
 * Phase 3E, Checkpoint B: estimateDynamoDBProvisionedMonthlyCost() -- the
 * single, centralized DynamoDB provisioned-capacity pricing calculation.
 * Rates sourced directly from AWS's own official pricing page
 * (https://aws.amazon.com/dynamodb/pricing/provisioned/) on 2026-09-07 --
 * see aws-pricing.ts's own doc comment for the full sourcing note. This
 * file only verifies the calculation is correct, deterministic, and uses
 * the exported constants (not a second, hardcoded rate) -- it does not
 * re-verify the rates themselves against AWS (that's a live-pricing
 * question, not a unit-test question).
 */
import {
  DYNAMODB_PROVISIONED_RCU_PER_HOUR_USD,
  DYNAMODB_PROVISIONED_WCU_PER_HOUR_USD,
  estimateDynamoDBProvisionedMonthlyCost,
} from '../aws-pricing';

describe('estimateDynamoDBProvisionedMonthlyCost', () => {
  it('computes cost for known RCU/WCU inputs (Standard table class) using the exported rate constants, not a hardcoded duplicate', () => {
    const rcu = 100;
    const wcu = 50;
    const hoursPerMonth = 730;

    const expected =
      rcu * DYNAMODB_PROVISIONED_RCU_PER_HOUR_USD.STANDARD * hoursPerMonth +
      wcu * DYNAMODB_PROVISIONED_WCU_PER_HOUR_USD.STANDARD * hoursPerMonth;

    expect(estimateDynamoDBProvisionedMonthlyCost(rcu, wcu)).toBeCloseTo(expected, 8);
  });

  it('defaults to the Standard table class when none is given', () => {
    const withDefault = estimateDynamoDBProvisionedMonthlyCost(100, 50);
    const explicitStandard = estimateDynamoDBProvisionedMonthlyCost(100, 50, 'STANDARD');
    expect(withDefault).toBeCloseTo(explicitStandard, 8);
  });

  it('defaults to the Standard table class for an unrecognized table_class value, never throwing or silently using a 0 rate', () => {
    const result = estimateDynamoDBProvisionedMonthlyCost(100, 50, 'SOME_FUTURE_CLASS');
    const explicitStandard = estimateDynamoDBProvisionedMonthlyCost(100, 50, 'STANDARD');
    expect(result).toBeCloseTo(explicitStandard, 8);
  });

  it('uses the real, distinct, higher Standard-IA rate when explicitly given', () => {
    const rcu = 100;
    const wcu = 50;
    const hoursPerMonth = 730;

    const standardCost = estimateDynamoDBProvisionedMonthlyCost(rcu, wcu, 'STANDARD');
    const iaCost = estimateDynamoDBProvisionedMonthlyCost(rcu, wcu, 'STANDARD_INFREQUENT_ACCESS');

    const expectedIaCost =
      rcu * DYNAMODB_PROVISIONED_RCU_PER_HOUR_USD.STANDARD_INFREQUENT_ACCESS * hoursPerMonth +
      wcu * DYNAMODB_PROVISIONED_WCU_PER_HOUR_USD.STANDARD_INFREQUENT_ACCESS * hoursPerMonth;

    expect(iaCost).toBeCloseTo(expectedIaCost, 8);
    // Standard-IA's real published rate is higher per-unit than Standard's --
    // this must not accidentally collapse to the same number.
    expect(iaCost).toBeGreaterThan(standardCost);
  });

  it('returns exactly 0 for genuinely zero RCU and WCU -- a real, confirmed zero, not a fabricated one', () => {
    expect(estimateDynamoDBProvisionedMonthlyCost(0, 0)).toBe(0);
  });

  it('computes RCU-only and WCU-only costs independently (zero on one axis does not zero out the other)', () => {
    const rcuOnly = estimateDynamoDBProvisionedMonthlyCost(100, 0);
    const wcuOnly = estimateDynamoDBProvisionedMonthlyCost(0, 100);

    expect(rcuOnly).toBeGreaterThan(0);
    expect(wcuOnly).toBeGreaterThan(0);
    // WCU is priced higher per-unit than RCU (real, published asymmetry) --
    // the same unit count must cost more on the write axis.
    expect(wcuOnly).toBeGreaterThan(rcuOnly);
  });

  it('is deterministic -- identical inputs always produce identical output', () => {
    const results = Array.from({ length: 5 }, () => estimateDynamoDBProvisionedMonthlyCost(123, 45, 'STANDARD'));
    expect(new Set(results).size).toBe(1);
  });

  it('scales linearly with capacity (doubling RCU and WCU doubles the cost)', () => {
    const base = estimateDynamoDBProvisionedMonthlyCost(50, 25);
    const doubled = estimateDynamoDBProvisionedMonthlyCost(100, 50);
    expect(doubled).toBeCloseTo(base * 2, 8);
  });
});
