/**
 * The shared Top Risk rule (founder decision D-B3, Nov 4): an accepted-risk or
 * dismissed finding is never the Top Risk, a low finding never is, and W11 is the
 * founder-approved text.
 */
import {
  isTopRiskEligible,
  noUrgentFindingsLine,
  selectTopRiskFinding,
  TOP_RISK_EXCLUDED_DISPOSITIONS,
  TOP_RISK_SEVERITIES,
} from '../top-risk-selection';
import { SECURITY_EVALUATION_MAX_AGE_SECONDS } from '../ai-summary.service';
import { STALE_AFTER_SECONDS } from '../../routes/services-coverage.routes';

const finding = (title: string, severity: string, disposition: string | null = null) => ({ title, severity, disposition });

describe('selectTopRiskFinding', () => {
  it('skips an accepted-risk finding, even the most severe one', () => {
    expect(selectTopRiskFinding([
      finding('Port 80 open', 'critical', 'accepted_risk'),
      finding('Old access key', 'medium'),
    ])).toEqual({ title: 'Old access key', severity: 'medium' });
  });

  it('skips a dismissed finding', () => {
    expect(selectTopRiskFinding([
      finding('Port 443 open', 'high', 'dismissed'),
      finding('No MFA', 'high'),
    ])).toEqual({ title: 'No MFA', severity: 'high' });
  });

  it('keeps an acknowledged finding: seen is not resolved', () => {
    expect(selectTopRiskFinding([finding('SSH open', 'critical', 'acknowledged')])).toEqual({ title: 'SSH open', severity: 'critical' });
  });

  it('never picks a low finding', () => {
    expect(selectTopRiskFinding([finding('Minor', 'low')])).toBeNull();
  });

  it('returns null when every urgent finding is accepted or dismissed', () => {
    expect(selectTopRiskFinding([
      finding('A', 'critical', 'accepted_risk'),
      finding('B', 'high', 'dismissed'),
      finding('C', 'low'),
    ])).toBeNull();
  });

  it('picks the most severe eligible finding whatever the input order', () => {
    expect(selectTopRiskFinding([finding('M', 'medium'), finding('H', 'high'), finding('C', 'critical')]))
      .toEqual({ title: 'C', severity: 'critical' });
  });

  it('within one severity keeps the given order (getActive: newest first)', () => {
    expect(selectTopRiskFinding([finding('Newer', 'high'), finding('Older', 'high')])).toEqual({ title: 'Newer', severity: 'high' });
  });

  it('treats a finding without a disposition as eligible', () => {
    expect(isTopRiskEligible({ title: 'x', severity: 'high' })).toBe(true);
  });

  it('a low finding is never eligible, whatever its disposition', () => {
    expect(isTopRiskEligible({ title: 'x', severity: 'low' })).toBe(false);
    expect(isTopRiskEligible({ title: 'x', severity: 'low', disposition: 'acknowledged' })).toBe(false);
  });

  it('excludes exactly accepted_risk and dismissed, over critical/high/medium', () => {
    expect([...TOP_RISK_EXCLUDED_DISPOSITIONS].sort()).toEqual(['accepted_risk', 'dismissed']);
    expect(TOP_RISK_SEVERITIES).toEqual(['critical', 'high', 'medium']);
  });
});

describe('W11', () => {
  it('is the approved wording, plural', () => {
    expect(noUrgentFindingsLine(3)).toBe('No critical, high or medium findings open. 3 lower-priority findings on the Security page.');
  });

  it('is the approved wording, singular', () => {
    expect(noUrgentFindingsLine(1)).toBe('No critical, high or medium findings open. 1 lower-priority finding on the Security page.');
  });
});

describe('security evaluation freshness', () => {
  it('uses the same staleness bound as the coverage page (13 hours)', () => {
    expect(SECURITY_EVALUATION_MAX_AGE_SECONDS).toBe(STALE_AFTER_SECONDS);
    expect(SECURITY_EVALUATION_MAX_AGE_SECONDS).toBe(13 * 60 * 60);
  });
});
