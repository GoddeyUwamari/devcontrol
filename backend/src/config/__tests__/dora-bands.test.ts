/**
 * config/dora-bands.ts: the one source of the standard comparison bands.
 *
 *   - Values pinned exactly (a change must bump `version`).
 *   - Each metric's levels are contiguous and non-overlapping, so every
 *     finite value has exactly one grade.
 *   - Every boundary of the D4 brief, both sides.
 *   - The wording is the ruled sentence and never says "DORA thresholds".
 */
import fs from 'fs';
import path from 'path';
import {
  DORA_BANDS,
  DORA_BANDS_DESCRIPTION,
  gradeAgainstBands,
  type BandLevel,
} from '../dora-bands';

const df = (v: number) => gradeAgainstBands(DORA_BANDS.deploymentFrequency, v);
const cfr = (v: number) => gradeAgainstBands(DORA_BANDS.changeFailureRate, v);

describe('DORA_BANDS values', () => {
  it('pins every boundary, label and the description (bump version to change any)', () => {
    expect(DORA_BANDS).toEqual({
      version: 1,
      description:
        'DevControl comparison bands are informed by the DORA 2023 performance clusters. These are directional benchmarks, not official DORA cutoffs.',
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
  });

  it('is frozen all the way down', () => {
    expect(Object.isFrozen(DORA_BANDS)).toBe(true);
    expect(Object.isFrozen(DORA_BANDS.changeFailureRate.levels)).toBe(true);
    expect(Object.isFrozen(DORA_BANDS.changeFailureRate.levels[0].upper)).toBe(true);
  });

  it('never calls them DORA thresholds', () => {
    expect(DORA_BANDS_DESCRIPTION).not.toMatch(/threshold/i);
    const source = fs.readFileSync(path.join(__dirname, '..', 'dora-bands.ts'), 'utf8');
    expect(source).not.toMatch(/DORA 2024 thresholds/);
  });

  it.each(['deploymentFrequency', 'changeFailureRate'] as const)(
    '%s: levels are ordered elite→low and contiguous, each bound shared with exactly one side inclusive',
    (metric) => {
      const levels = DORA_BANDS[metric].levels;
      expect(levels.map((l) => l.level)).toEqual(['elite', 'high', 'medium', 'low']);
      // The open ends sit at the outer levels only.
      const higherIsBetter = DORA_BANDS[metric].direction === 'higher_is_better';
      const top = higherIsBetter ? 'upper' : 'lower';
      const bottom = higherIsBetter ? 'lower' : 'upper';
      expect(levels[0][top]).toBeNull();
      expect(levels[3][bottom]).toBeNull();
      for (let i = 0; i < 3; i++) {
        const better = levels[i][bottom]!;
        const worse = levels[i + 1][top]!;
        expect(worse.value).toBe(better.value);
        expect(better.inclusive !== worse.inclusive).toBe(true);
      }
    }
  );
});

describe('gradeAgainstBands: deployment frequency boundaries (Elite is > 1)', () => {
  it.each<[number, BandLevel]>([
    [0, 'low'],
    [0.0299, 'low'],
    [0.03, 'medium'],
    [0.1399, 'medium'],
    [0.14, 'high'],
    [0.9999, 'high'],
    [1, 'high'],
    [1.0001, 'elite'],
    [50, 'elite'],
  ])('%s/day → %s', (value, level) => {
    expect(df(value)).toBe(level);
  });

  it('a real weekly / monthly cadence over the shipped windows grades as before', () => {
    expect(df(1 / 7)).toBe('high');     // 1 in 7 days = 0.1429
    expect(df(1 / 30)).toBe('medium');  // 1 in 30 days = 0.0333
    expect(df(2 / 90)).toBe('low');     // 0.0222
  });
});

describe('gradeAgainstBands: change failure rate boundaries', () => {
  it.each<[number, BandLevel]>([
    [0, 'elite'],
    [5, 'elite'],
    [5.0001, 'high'],
    [5.01, 'high'],
    [10, 'high'],
    [10.0001, 'medium'],
    [15, 'medium'],
    [15.0001, 'low'],
    [100, 'low'],
  ])('%s%% → %s', (value, level) => {
    expect(cfr(value)).toBe(level);
  });

  it('refuses a non-finite value: no grade without a measurement', () => {
    expect(() => cfr(Number.NaN)).toThrow();
    expect(() => df(Number.POSITIVE_INFINITY)).toThrow();
  });
});
