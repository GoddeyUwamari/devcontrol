/**
 * DevControl's standard comparison bands for the two DORA metrics the
 * deployment records support: deployment frequency and change failure rate.
 *
 * This is the ONLY place the standard (non-custom) bands live. The industry
 * grade in GET /api/metrics/dora is computed from these objects by
 * gradeAgainstBands(), and the same objects are returned verbatim in the
 * response as `bands`, so whatever renders the table reads exactly the
 * boundaries that graded the value. The frontend never imports this file.
 *
 * They are comparison bands informed by the DORA 2023 performance clusters,
 * not DORA's own thresholds: never call them "DORA thresholds".
 *
 * Deployment frequency (successful deployments per day, higher is better).
 * The decimals are the real cutoffs; "once a week" / "once a month" are
 * labels only (1/week = 0.1429/day, 1/month of 30 days = 0.0333/day):
 *   elite  > 1
 *   high   >= 0.14 and <= 1
 *   medium >= 0.03 and < 0.14
 *   low    < 0.03
 *
 * Change failure rate (failed / finished, in percent, lower is better):
 *   elite  <= 5
 *   high   > 5 and <= 10
 *   medium > 10 and <= 15
 *   low    > 15
 *
 * Every level carries both of its bounds (null = open), so the bands can be
 * checked to be contiguous and non-overlapping (config/__tests__/dora-bands.test.ts).
 * Any change to a boundary must bump `version`.
 *
 * Custom (Enterprise) targets are not here: they are graded by the
 * multipliers in DORAMetricsService.
 *
 * Pure data: no database.
 */

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

export type BandLevel = 'elite' | 'high' | 'medium' | 'low';

export interface BandBound {
  value: number;
  /** True when a value equal to the bound is inside the level. */
  inclusive: boolean;
}

export interface Band {
  level: BandLevel;
  /** Null = no lower bound. */
  lower: BandBound | null;
  /** Null = no upper bound. */
  upper: BandBound | null;
  /** Plain-language label. The numeric bounds are what grade; the label only describes them. */
  label: string;
}

export interface MetricBands {
  unit: 'per_day' | 'percentage';
  direction: 'higher_is_better' | 'lower_is_better';
  /** Best first: elite, high, medium, low. */
  levels: readonly Band[];
}

export interface DoraBands {
  version: number;
  description: string;
  deploymentFrequency: MetricBands;
  changeFailureRate: MetricBands;
}

export const DORA_BANDS_DESCRIPTION =
  'DevControl comparison bands are informed by the DORA 2023 performance clusters. These are directional benchmarks, not official DORA cutoffs.';

export const DORA_BANDS: DoraBands = deepFreeze({
  version: 1,
  description: DORA_BANDS_DESCRIPTION,
  deploymentFrequency: {
    unit: 'per_day',
    direction: 'higher_is_better',
    levels: [
      { level: 'elite',  lower: { value: 1,    inclusive: false }, upper: null,                               label: 'More than once a day' },
      { level: 'high',   lower: { value: 0.14, inclusive: true },  upper: { value: 1,    inclusive: true },  label: 'At least once a week (0.14 per day), up to once a day' },
      { level: 'medium', lower: { value: 0.03, inclusive: true },  upper: { value: 0.14, inclusive: false }, label: 'At least once a month (0.03 per day), less than once a week' },
      { level: 'low',    lower: null,                              upper: { value: 0.03, inclusive: false }, label: 'Less than once a month (below 0.03 per day)' },
    ],
  },
  changeFailureRate: {
    unit: 'percentage',
    direction: 'lower_is_better',
    levels: [
      { level: 'elite',  lower: null,                            upper: { value: 5,  inclusive: true }, label: '5% or less' },
      { level: 'high',   lower: { value: 5,  inclusive: false }, upper: { value: 10, inclusive: true }, label: 'More than 5%, up to 10%' },
      { level: 'medium', lower: { value: 10, inclusive: false }, upper: { value: 15, inclusive: true }, label: 'More than 10%, up to 15%' },
      { level: 'low',    lower: { value: 15, inclusive: false }, upper: null,                           label: 'More than 15%' },
    ],
  },
});

function insideBound(value: number, band: Band): boolean {
  const { lower, upper } = band;
  if (lower && !(lower.inclusive ? value >= lower.value : value > lower.value)) return false;
  if (upper && !(upper.inclusive ? value <= upper.value : value < upper.value)) return false;
  return true;
}

/**
 * The level whose bounds contain `value`. Throws for a non-finite value: a
 * missing measurement has no grade, and callers pass null/NaN never.
 */
export function gradeAgainstBands(bands: MetricBands, value: number): BandLevel {
  if (!Number.isFinite(value)) {
    throw new Error('gradeAgainstBands: value must be a finite number');
  }
  const match = bands.levels.find((band) => insideBound(value, band));
  if (!match) {
    // Unreachable while the bands are contiguous (pinned by the config test).
    throw new Error(`gradeAgainstBands: no band contains ${value}`);
  }
  return match.level;
}
