/**
 * Phase 3E, `dynamodb_on_demand_vs_provisioned`: the two new pricing helpers
 * -- estimateDynamoDBOnDemandCostFromRequestUnits() and
 * estimateDynamoDBProvisionedCostFromUnitHours() -- and the on-demand rate
 * constants they use. Rates sourced directly from AWS's own official pricing
 * page (https://aws.amazon.com/dynamodb/pricing/on-demand/) on 2026-09-08,
 * cross-checked against the request-unit definitions in AWS's Developer
 * Guide -- see aws-pricing.ts's own doc comment for the full sourcing note.
 * This file only verifies the calculations are correct, deterministic, and
 * use the exported constants (never a second, hardcoded rate) -- it does
 * not re-verify the rates themselves against AWS.
 */
import {
  DYNAMODB_ON_DEMAND_RRU_PRICE_PER_MILLION_USD,
  DYNAMODB_ON_DEMAND_WRU_PRICE_PER_MILLION_USD,
  DYNAMODB_PROVISIONED_RCU_PER_HOUR_USD,
  DYNAMODB_PROVISIONED_WCU_PER_HOUR_USD,
  estimateDynamoDBOnDemandCostFromRequestUnits,
  estimateDynamoDBProvisionedCostFromUnitHours,
} from '../aws-pricing';

describe('estimateDynamoDBOnDemandCostFromRequestUnits', () => {
  it('computes cost for known RRU/WRU inputs (Standard) using the exported rate constants, not a hardcoded duplicate', () => {
    const rru = 5_000_000;
    const wru = 2_000_000;

    const expected =
      (rru / 1_000_000) * DYNAMODB_ON_DEMAND_RRU_PRICE_PER_MILLION_USD.STANDARD +
      (wru / 1_000_000) * DYNAMODB_ON_DEMAND_WRU_PRICE_PER_MILLION_USD.STANDARD;

    expect(estimateDynamoDBOnDemandCostFromRequestUnits(rru, wru)).toBeCloseTo(expected, 8);
  });

  it('defaults to the Standard table class when none is given', () => {
    const withDefault = estimateDynamoDBOnDemandCostFromRequestUnits(1_000_000, 500_000);
    const explicitStandard = estimateDynamoDBOnDemandCostFromRequestUnits(1_000_000, 500_000, 'STANDARD');
    expect(withDefault).toBeCloseTo(explicitStandard, 8);
  });

  it('defaults to the Standard table class for an unrecognized table_class value, never throwing or silently using a 0 rate', () => {
    const result = estimateDynamoDBOnDemandCostFromRequestUnits(1_000_000, 500_000, 'SOME_FUTURE_CLASS');
    const explicitStandard = estimateDynamoDBOnDemandCostFromRequestUnits(1_000_000, 500_000, 'STANDARD');
    expect(result).toBeCloseTo(explicitStandard, 8);
  });

  it('uses the real, distinct, higher Standard-IA on-demand rate when explicitly given', () => {
    const rru = 1_000_000;
    const wru = 1_000_000;

    const standardCost = estimateDynamoDBOnDemandCostFromRequestUnits(rru, wru, 'STANDARD');
    const iaCost = estimateDynamoDBOnDemandCostFromRequestUnits(rru, wru, 'STANDARD_INFREQUENT_ACCESS');

    const expectedIaCost =
      (rru / 1_000_000) * DYNAMODB_ON_DEMAND_RRU_PRICE_PER_MILLION_USD.STANDARD_INFREQUENT_ACCESS +
      (wru / 1_000_000) * DYNAMODB_ON_DEMAND_WRU_PRICE_PER_MILLION_USD.STANDARD_INFREQUENT_ACCESS;

    expect(iaCost).toBeCloseTo(expectedIaCost, 8);
    expect(iaCost).toBeGreaterThan(standardCost);
  });

  it('returns exactly 0 for genuinely zero request units -- a real, confirmed zero, not a fabricated one', () => {
    expect(estimateDynamoDBOnDemandCostFromRequestUnits(0, 0)).toBe(0);
  });

  it('computes read-only and write-only costs independently (zero on one axis does not zero out the other)', () => {
    const readOnly = estimateDynamoDBOnDemandCostFromRequestUnits(1_000_000, 0);
    const writeOnly = estimateDynamoDBOnDemandCostFromRequestUnits(0, 1_000_000);

    expect(readOnly).toBeGreaterThan(0);
    expect(writeOnly).toBeGreaterThan(0);
    // WRU is priced higher per-unit than RRU (real, published asymmetry) --
    // the same unit count must cost more on the write axis.
    expect(writeOnly).toBeGreaterThan(readOnly);
  });

  it('is deterministic -- identical inputs always produce identical output', () => {
    const results = Array.from({ length: 5 }, () => estimateDynamoDBOnDemandCostFromRequestUnits(1_234_567, 456_789, 'STANDARD'));
    expect(new Set(results).size).toBe(1);
  });

  it('scales linearly with request-unit volume (doubling doubles the cost)', () => {
    const base = estimateDynamoDBOnDemandCostFromRequestUnits(500_000, 250_000);
    const doubled = estimateDynamoDBOnDemandCostFromRequestUnits(1_000_000, 500_000);
    expect(doubled).toBeCloseTo(base * 2, 8);
  });
});

describe('estimateDynamoDBProvisionedCostFromUnitHours', () => {
  it('computes cost for known RCU-hour/WCU-hour inputs (Standard) using the exported rate constants, not a hardcoded duplicate', () => {
    const rcuHours = 100 * 720; // e.g. 100 RCU held for the full 720-hour nominal window
    const wcuHours = 50 * 720;

    const expected =
      rcuHours * DYNAMODB_PROVISIONED_RCU_PER_HOUR_USD.STANDARD + wcuHours * DYNAMODB_PROVISIONED_WCU_PER_HOUR_USD.STANDARD;

    expect(estimateDynamoDBProvisionedCostFromUnitHours(rcuHours, wcuHours)).toBeCloseTo(expected, 8);
  });

  it('does NOT apply the 730-hours/month convention -- it is a pure unit-hours x rate calculation', () => {
    // If this reused the 730-hour monthly helper's convention, 720 unit-hours
    // (30 days x 24h, the analysis window's nominal interval count) would NOT
    // equal rate x 720 -- confirming this function trusts the caller's own
    // already-summed unit-hours rather than re-deriving a canonical month.
    const rcuUnitHours = 720;
    const expected = rcuUnitHours * DYNAMODB_PROVISIONED_RCU_PER_HOUR_USD.STANDARD;
    expect(estimateDynamoDBProvisionedCostFromUnitHours(rcuUnitHours, 0)).toBeCloseTo(expected, 8);
  });

  it('defaults to the Standard table class when none is given', () => {
    const withDefault = estimateDynamoDBProvisionedCostFromUnitHours(1000, 500);
    const explicitStandard = estimateDynamoDBProvisionedCostFromUnitHours(1000, 500, 'STANDARD');
    expect(withDefault).toBeCloseTo(explicitStandard, 8);
  });

  it('defaults to the Standard table class for an unrecognized table_class value, never throwing or silently using a 0 rate', () => {
    const result = estimateDynamoDBProvisionedCostFromUnitHours(1000, 500, 'SOME_FUTURE_CLASS');
    const explicitStandard = estimateDynamoDBProvisionedCostFromUnitHours(1000, 500, 'STANDARD');
    expect(result).toBeCloseTo(explicitStandard, 8);
  });

  it('uses the real, distinct, higher Standard-IA provisioned rate when explicitly given', () => {
    const rcuHours = 1000;
    const wcuHours = 1000;

    const standardCost = estimateDynamoDBProvisionedCostFromUnitHours(rcuHours, wcuHours, 'STANDARD');
    const iaCost = estimateDynamoDBProvisionedCostFromUnitHours(rcuHours, wcuHours, 'STANDARD_INFREQUENT_ACCESS');

    const expectedIaCost =
      rcuHours * DYNAMODB_PROVISIONED_RCU_PER_HOUR_USD.STANDARD_INFREQUENT_ACCESS +
      wcuHours * DYNAMODB_PROVISIONED_WCU_PER_HOUR_USD.STANDARD_INFREQUENT_ACCESS;

    expect(iaCost).toBeCloseTo(expectedIaCost, 8);
    expect(iaCost).toBeGreaterThan(standardCost);
  });

  it('returns exactly 0 for genuinely zero unit-hours -- a real, confirmed zero, not a fabricated one', () => {
    expect(estimateDynamoDBProvisionedCostFromUnitHours(0, 0)).toBe(0);
  });

  it('is deterministic -- identical inputs always produce identical output', () => {
    const results = Array.from({ length: 5 }, () => estimateDynamoDBProvisionedCostFromUnitHours(12345, 6789, 'STANDARD'));
    expect(new Set(results).size).toBe(1);
  });
});
