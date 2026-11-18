/**
 * The brief's formatting (UTC dates, day ranges, money) and the retained,
 * unused recommendation guard (WE-D9; moved from weekly-summary-content.ts).
 */
import { formatDays, formatMoney, formatOpenSavings, formatSignedMoney, formatSubjectWindow, formatTime } from '../format';
import { buildRecommendationPrompt, checkRecommendationText } from '../recommendation-guard';
import { composeWeeklyBrief } from '../rules';
import { notSupported } from '../../ai-context-contract';
import { FIXTURE_ORG_NAME, fixtureFacts } from '../../../jobs/__tests__/weekly-email-fixtures';

describe('formatting', () => {
  it('subject windows across a month and a year', () => {
    expect(formatSubjectWindow({ start: '2026-11-09', endExclusive: '2026-11-16' })).toBe('Nov 9 – 15, 2026');
    expect(formatSubjectWindow({ start: '2026-10-26', endExclusive: '2026-11-02' })).toBe('Oct 26 – Nov 1, 2026');
    expect(formatSubjectWindow({ start: '2026-12-28', endExclusive: '2027-01-04' })).toBe('Dec 28, 2026 – Jan 3, 2027');
  });

  it('day ranges: one day, a run, across a month, and a gap', () => {
    expect(formatDays(['2026-11-13'])).toBe('Nov 13');
    expect(formatDays(['2026-11-12', '2026-11-10', '2026-11-11'])).toBe('Nov 10–12');
    expect(formatDays(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])).toBe('Oct 30 – Nov 2');
    expect(formatDays(['2026-11-10', '2026-11-11', '2026-11-14'])).toBe('Nov 10–11, Nov 14');
  });

  it('times are UTC, without the year (the header carries it)', () => {
    expect(formatTime('2026-11-15T06:00:00.000Z')).toBe('Nov 15, 06:00 UTC');
    expect(formatTime('2026-11-15T23:59:00.000-05:00')).toBe('Nov 16, 04:59 UTC');
  });

  it('money: cents, a real minus sign, and signed changes', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatMoney(-0.48)).toBe('−$0.48');
    expect(formatMoney(-0.001)).toBe('$0.00');
    expect(formatSignedMoney(0.48)).toBe('+$0.48');
    expect(formatSignedMoney(-0.48)).toBe('−$0.48');
  });

  it('open savings: null without an estimate; "<$0.01/mo" for a positive estimate that rounds to $0', () => {
    expect(formatOpenSavings(0, 0)).toBeNull();
    expect(formatOpenSavings(0, 2)).toBe('<$0.01/mo');
    expect(formatOpenSavings(845, 3)).toBe('$845/mo');
  });
});

// Kept, unused, pending a grounded redesign (WE-D9); these pin their behaviour only.
describe('retained recommendation guard', () => {
  const facts = fixtureFacts('A');
  const prompt = buildRecommendationPrompt(facts, composeWeeklyBrief(facts, { organizationName: FIXTURE_ORG_NAME, planName: 'Optimization Engine' }))!;

  it('invented $/% figures are rejected; grounded text passes', () => {
    expect(checkRecommendationText('Costs rose 35% this week; act now.', prompt).text).toBeNull();
    expect(checkRecommendationText('Review the 3 open cost opportunities, estimated at $900/mo.', prompt).text).toBeNull();
    const grounded = 'Review the 4 account-level findings first, then the 3 open cost opportunities (about $42/mo estimated).';
    expect(checkRecommendationText(grounded, prompt).text).toBe(grounded);
  });

  it('forbidden claims are rejected whatever the figures', () => {
    expect(checkRecommendationText('Shorten your lead time for changes.', prompt).rejected).toBe('mentions DORA lead time');
    expect(checkRecommendationText('You can save money with Savings Plans.', prompt).text).toBeNull();
  });

  it('the prompt carries the brief\'s facts and the no-fabrication rules; nothing to say when nothing is open', () => {
    expect(prompt).toMatch(/Do not recommend rightsizing, Reserved Instances, or Savings Plans/);
    expect(prompt).toContain('Security · 14 open findings');
    expect(prompt).not.toMatch(/not tracked/i);
    const clean = fixtureFacts('B');
    expect(buildRecommendationPrompt(clean, composeWeeklyBrief(clean))).toBeNull();
  });

  it('notSupported stays distinct from unavailable and error states', () => {
    const s = notSupported({ source: 'x' }, 'why');
    expect(s.state).toBe('not_supported');
    expect(s.data).toBeNull();
  });
});
