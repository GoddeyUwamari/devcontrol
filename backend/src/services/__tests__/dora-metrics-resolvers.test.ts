/**
 * DORAMetricsService's benchmark resolvers.
 *
 *   - Without a custom target: the standard bands of config/dora-bands.ts,
 *     at every boundary of the D4 brief (Elite frequency is > 1).
 *   - With a custom (Enterprise) target t: exactly the multipliers and
 *     operators in place before D4 (D4-D4: no customer's custom grading
 *     changes), including custom frequency's ≥ t for elite.
 */
import { DORAMetricsService, type BenchmarkLevel } from '../dora-metrics.service';
import type { DORAMetricsRepository } from '../../repositories/dora-metrics.repository';

const service = new DORAMetricsService({} as DORAMetricsRepository);
const custom = (t: number) => ({ target_value: t, performance_label: 'Team target' });

describe('standard bands', () => {
  it.each<[number, BenchmarkLevel]>([
    [0, 'low'], [0.0299, 'low'], [0.03, 'medium'], [0.1399, 'medium'], [0.14, 'high'],
    [0.9999, 'high'], [1, 'high'], [1.0001, 'elite'], [1.01, 'elite'],
  ])('deployment frequency %s/day → %s', (value, level) => {
    expect(service.resolveDeploymentFrequency(value)).toEqual({ benchmark: level, isCustomBenchmark: false });
  });

  it.each<[number, BenchmarkLevel]>([
    [0, 'elite'], [5, 'elite'], [5.01, 'high'], [10, 'high'], [10.01, 'medium'], [15, 'medium'], [15.01, 'low'],
    // The old 15 / 30 / 45 bands graded these elite / elite / high / medium:
    [7.5, 'high'], [12.5, 'medium'], [25, 'low'], [40, 'low'],
  ])('change failure rate %s%% → %s', (value, level) => {
    expect(service.resolveChangeFailureRate(value)).toEqual({ benchmark: level, isCustomBenchmark: false });
  });
});

describe('custom targets keep the pre-D4 rule exactly', () => {
  it.each<[number, number, BenchmarkLevel]>([
    // t = 1: elite ≥ 1 (the standard band would say high at exactly 1), high ≥ 0.5, medium ≥ 0.2
    [1, 1, 'elite'], [1, 0.99, 'high'], [1, 0.5, 'high'], [1, 0.49, 'medium'], [1, 0.2, 'medium'], [1, 0.19, 'low'],
    // t = 100 (the plan-gates fixture): 0.3/day is low
    [100, 0.3, 'low'], [100, 100, 'elite'],
  ])('deployment frequency, target %s: %s/day → %s', (t, value, level) => {
    expect(service.resolveDeploymentFrequency(value, custom(t))).toEqual({ benchmark: level, isCustomBenchmark: true });
  });

  it.each<[number, number, BenchmarkLevel]>([
    // elite ≤ t, high ≤ 2t, medium ≤ 3t (not 5t), low above
    [2, 2, 'elite'], [2, 2.01, 'high'], [2, 4, 'high'], [2, 4.01, 'medium'], [2, 6, 'medium'], [2, 6.01, 'low'], [2, 9, 'low'],
    [20, 25, 'high'],
  ])('change failure rate, target %s: %s%% → %s', (t, value, level) => {
    expect(service.resolveChangeFailureRate(value, custom(t))).toEqual({ benchmark: level, isCustomBenchmark: true });
  });

  it('lead time (×2 / ×5) and time to restore (×3 / ×10) custom multipliers are unchanged (both unused)', () => {
    expect(service.resolveLeadTime(10, custom(2)).benchmark).toBe('medium');
    expect(service.resolveLeadTime(10.01, custom(2)).benchmark).toBe('low');
    expect(service.resolveMTTR(6, custom(2)).benchmark).toBe('high');
    expect(service.resolveMTTR(20, custom(2)).benchmark).toBe('medium');
    expect(service.resolveMTTR(20.01, custom(2)).benchmark).toBe('low');
  });
});
