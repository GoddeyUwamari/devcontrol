/**
 * Phase 3E, dynamodb_capacity: analyzeDynamoDBCapacityDimension() -- the pure
 * per-dimension reduction the detector's eligibility policy is built on.
 * Locked methodology: missing consumed/provisioned datapoints exclude an
 * interval entirely (never 0%/100%); throttle validity is tracked completely
 * independently of utilization validity; the "highest" figure must be an
 * hourly average, never relabeled as peak.
 */
import { analyzeDynamoDBCapacityDimension } from '../dynamodb-capacity-analysis.util';

const REF_THRESHOLD = 20;

function nulls(n: number): Array<number | null> {
  return new Array(n).fill(null);
}

describe('analyzeDynamoDBCapacityDimension', () => {
  it('computes valid intervals, low-utilization percentage, and the highest hourly-average utilization', () => {
    // 4 intervals: 3 at 10% utilization (below 20%), 1 at 50% (above 20%, and the highest).
    const consumed = [10, 10, 10, 50];
    const provisioned = [100, 100, 100, 100];
    const throttle = [0, 0, 0, 0];

    const result = analyzeDynamoDBCapacityDimension(consumed, provisioned, throttle, REF_THRESHOLD);

    expect(result.totalIntervals).toBe(4);
    expect(result.validUtilizationIntervals).toBe(4);
    expect(result.lowUtilizationIntervals).toBe(3);
    expect(result.lowUtilizationPercentage).toBe(75);
    expect(result.highestHourlyAverageUtilizationPercent).toBe(50);
    expect(result.highestHourlyAverageThroughputPerSecond).toBe(50);
  });

  it('excludes an interval with a missing consumed datapoint -- never treats it as 0% utilization', () => {
    const consumed = [null, 10];
    const provisioned = [100, 100];
    const throttle = [0, 0];

    const result = analyzeDynamoDBCapacityDimension(consumed, provisioned, throttle, REF_THRESHOLD);

    expect(result.validUtilizationIntervals).toBe(1);
    expect(result.lowUtilizationIntervals).toBe(1);
    expect(result.lowUtilizationPercentage).toBe(100);
  });

  it('excludes an interval with a missing provisioned datapoint -- never treats it as 100% utilization', () => {
    const consumed = [10, 10];
    const provisioned = [null, 100];
    const throttle = [0, 0];

    const result = analyzeDynamoDBCapacityDimension(consumed, provisioned, throttle, REF_THRESHOLD);

    expect(result.validUtilizationIntervals).toBe(1);
  });

  it('excludes an interval with non-positive provisioned capacity as a defensive guard against division by zero', () => {
    const consumed = [10, 10];
    const provisioned = [0, 100];
    const throttle = [0, 0];

    const result = analyzeDynamoDBCapacityDimension(consumed, provisioned, throttle, REF_THRESHOLD);

    expect(result.validUtilizationIntervals).toBe(1);
  });

  it('treats a utilization value exactly at the reference threshold as NOT below it', () => {
    const consumed = [20]; // exactly 20% of 100
    const provisioned = [100];
    const throttle = [0];

    const result = analyzeDynamoDBCapacityDimension(consumed, provisioned, throttle, REF_THRESHOLD);

    expect(result.lowUtilizationIntervals).toBe(0);
    expect(result.lowUtilizationPercentage).toBe(0);
  });

  it('reports lowUtilizationPercentage as 0 (not NaN) when there are zero valid utilization intervals', () => {
    const result = analyzeDynamoDBCapacityDimension(nulls(3), nulls(3), nulls(3), REF_THRESHOLD);

    expect(result.validUtilizationIntervals).toBe(0);
    expect(result.lowUtilizationPercentage).toBe(0);
    expect(result.highestHourlyAverageUtilizationPercent).toBeNull();
    expect(result.highestHourlyAverageThroughputPerSecond).toBeNull();
  });

  it('tracks throttle validity completely independently of utilization validity', () => {
    // Utilization data is missing everywhere, but throttle data is present.
    const consumed = nulls(2);
    const provisioned = nulls(2);
    const throttle = [0, 0];

    const result = analyzeDynamoDBCapacityDimension(consumed, provisioned, throttle, REF_THRESHOLD);

    expect(result.validUtilizationIntervals).toBe(0);
    expect(result.throttleValidIntervals).toBe(2);
    expect(result.throttleConfirmedIntervals).toBe(0);
  });

  it('never treats a missing throttle datapoint as confirmed zero throttling', () => {
    const consumed = [10, 10];
    const provisioned = [100, 100];
    const throttle = [null, null];

    const result = analyzeDynamoDBCapacityDimension(consumed, provisioned, throttle, REF_THRESHOLD);

    expect(result.throttleValidIntervals).toBe(0);
    expect(result.throttleConfirmedIntervals).toBe(0);
  });

  it('confirms throttling when any valid throttle interval has Sum > 0', () => {
    const consumed = [10, 10];
    const provisioned = [100, 100];
    const throttle = [0, 3];

    const result = analyzeDynamoDBCapacityDimension(consumed, provisioned, throttle, REF_THRESHOLD);

    expect(result.throttleValidIntervals).toBe(2);
    expect(result.throttleConfirmedIntervals).toBe(1);
  });
});
