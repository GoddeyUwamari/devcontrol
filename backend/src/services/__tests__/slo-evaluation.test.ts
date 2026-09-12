/**
 * Pure unit coverage for slo-evaluation.ts's SLI/error-budget methodology. No AWS or
 * database access — this module is deliberately dependency-free (see its own header
 * comment), so every case here is a plain function call against constructed inputs.
 */

import { evaluateSlo, computeErrorBudget, SloRawObservation } from '../slo-evaluation';

function observation(overrides: Partial<SloRawObservation>): SloRawObservation {
  return { resourceExists: true, monitored: true, uptime: null, avgLatencyMs: null, errorRatePercent: null, ...overrides };
}

describe('evaluateSlo — ec2_availability', () => {
  it('(1) observed uptime above target is healthy', () => {
    const result = evaluateSlo('ec2_availability', 99.9, true, observation({ uptime: 99.95 }));
    expect(result.status).toBe('healthy');
    expect(result.observedValue).toBe(99.95);
  });

  it('(2) observed uptime below target is breached', () => {
    const result = evaluateSlo('ec2_availability', 99.9, true, observation({ uptime: 99.5 }));
    expect(result.status).toBe('breached');
  });

  it('(3) observed uptime exactly at target is healthy (>=, not >)', () => {
    const result = evaluateSlo('ec2_availability', 99.9, true, observation({ uptime: 99.9 }));
    expect(result.status).toBe('healthy');
  });

  it('(4) error budget is computed for a healthy evaluation', () => {
    const result = evaluateSlo('ec2_availability', 99.9, true, observation({ uptime: 99.95 }));
    expect(result.errorBudget.applicable).toBe(true);
    expect(result.errorBudget.allowedFailureRate).toBeCloseTo(0.001, 6);
    expect(result.errorBudget.observedFailureRate).toBeCloseTo(0.0005, 6);
    expect(result.errorBudget.consumedFraction).toBeCloseTo(0.5, 6);
    expect(result.errorBudget.remainingFraction).toBeCloseTo(0.5, 6);
  });

  it('(5) a breached SLO reports consumedFraction > 1 and a negative remaining budget, never clamped', () => {
    const result = evaluateSlo('ec2_availability', 99.9, true, observation({ uptime: 99.5 }));
    expect(result.errorBudget.consumedFraction).toBeGreaterThan(1);
    expect(result.errorBudget.remainingFraction).toBeLessThan(0);
  });

  it('(6) near-zero error budget: observed just barely meets target', () => {
    const result = evaluateSlo('ec2_availability', 99.9, true, observation({ uptime: 99.9001 }));
    expect(result.status).toBe('healthy');
    expect(result.errorBudget.consumedFraction).toBeGreaterThan(0.9);
    expect(result.errorBudget.consumedFraction).toBeLessThanOrEqual(1);
  });
});

describe('evaluateSlo — alb_latency_avg (no error budget)', () => {
  it('(7) observed latency at or under target is healthy', () => {
    const result = evaluateSlo('alb_latency_avg', 500, true, observation({ avgLatencyMs: 320 }));
    expect(result.status).toBe('healthy');
    expect(result.observedValue).toBe(320);
    expect(result.unit).toBe('ms');
  });

  it('(8) observed latency over target is breached', () => {
    const result = evaluateSlo('alb_latency_avg', 500, true, observation({ avgLatencyMs: 800 }));
    expect(result.status).toBe('breached');
  });

  it('(9) error budget is never applicable for latency, healthy or breached', () => {
    const healthy = evaluateSlo('alb_latency_avg', 500, true, observation({ avgLatencyMs: 100 }));
    const breached = evaluateSlo('alb_latency_avg', 500, true, observation({ avgLatencyMs: 900 }));
    expect(healthy.errorBudget.applicable).toBe(false);
    expect(breached.errorBudget.applicable).toBe(false);
    expect(healthy.errorBudget.consumedFraction).toBeNull();
    expect(breached.errorBudget.consumedFraction).toBeNull();
  });
});

describe('evaluateSlo — alb_error_rate / lambda_error_rate', () => {
  it('(10) low error rate meeting the success target is healthy', () => {
    // target 99 = require >=99% success; 1% error rate = 99% success -> healthy at the boundary
    const result = evaluateSlo('alb_error_rate', 99, true, observation({ errorRatePercent: 1 }));
    expect(result.status).toBe('healthy');
    expect(result.observedValue).toBe(99);
  });

  it('(11) high error rate breaching the success target is breached', () => {
    const result = evaluateSlo('lambda_error_rate', 99, true, observation({ errorRatePercent: 5 }));
    expect(result.status).toBe('breached');
    expect(result.observedValue).toBe(95);
  });

  it('(12) lambda and ALB error rates are evaluated independently, not merged into one generic metric', () => {
    const albOnly = evaluateSlo('alb_error_rate', 99, true, observation({ errorRatePercent: 0.5 }));
    const lambdaOnly = evaluateSlo('lambda_error_rate', 99, true, observation({ errorRatePercent: 0.5 }));
    expect(albOnly.status).toBe('healthy');
    expect(lambdaOnly.status).toBe('healthy');
    // Distinct evaluations, not a shared/cached object.
    expect(albOnly).not.toBe(lambdaOnly);
  });
});

describe('evaluateSlo — non-healthy/breached states are never fabricated as a number', () => {
  it('(13) AWS not connected yields aws_not_connected, not 0%', () => {
    const result = evaluateSlo('ec2_availability', 99.9, false, null);
    expect(result.status).toBe('aws_not_connected');
    expect(result.observedValue).toBeNull();
    expect(result.errorBudget.applicable).toBe(false);
  });

  it('(14) a missing/deleted resource yields resource_not_found, not 0%', () => {
    const result = evaluateSlo('ec2_availability', 99.9, true, observation({ resourceExists: false, monitored: false }));
    expect(result.status).toBe('resource_not_found');
    expect(result.observedValue).toBeNull();
  });

  it('(15) CloudWatch returning no datapoints yields insufficient_data, not 0%', () => {
    const result = evaluateSlo('ec2_availability', 99.9, true, observation({ monitored: false, uptime: null }));
    expect(result.status).toBe('insufficient_data');
    expect(result.observedValue).toBeNull();
  });

  it('(16) monitored=true but the specific raw value is null still yields insufficient_data', () => {
    // Defensive case: monitored true (some metric had data) but this SLI's specific
    // field is null (e.g. an ALB with request data but no latency datapoint yet).
    const result = evaluateSlo('alb_latency_avg', 500, true, observation({ monitored: true, avgLatencyMs: null }));
    expect(result.status).toBe('insufficient_data');
  });

  it('(17) invalid/unsupported evaluation inputs never silently become healthy', () => {
    const result = evaluateSlo('ec2_availability', 99.9, true, observation({ resourceExists: true, monitored: false }));
    expect(result.status).not.toBe('healthy');
    expect(result.status).not.toBe('breached');
  });
});

describe('computeErrorBudget — direct coverage', () => {
  it('(18) matches the documented formula exactly', () => {
    const budget = computeErrorBudget('ec2_availability', 99.95, 99.9);
    expect(budget.allowedFailureRate).toBeCloseTo(0.001, 6);
    expect(budget.observedFailureRate).toBeCloseTo(0.0005, 6);
    expect(budget.consumedFraction).toBeCloseTo(0.5, 6);
  });

  it('(19) a perfect 100% observed success against a target under 100 consumes 0% of budget', () => {
    const budget = computeErrorBudget('lambda_error_rate', 100, 99.9);
    expect(budget.observedFailureRate).toBe(0);
    expect(budget.consumedFraction).toBe(0);
    expect(budget.remainingFraction).toBe(1);
  });
});
