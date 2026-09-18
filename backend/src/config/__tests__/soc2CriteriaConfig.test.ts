/**
 * Coverage for SOC 2 Readiness v1's versioned criteria config. Asserts exactly the six
 * approved criteria exist, with correct disposition classes, and that CC7.1's wording
 * never drifts into a broader "security monitoring" claim than what DevControl actually
 * observes.
 */
import { SOC2_CRITERIA_CONFIG_VERSION, SOC2_V1_CRITERIA, getSoc2CriterionConfig } from '../soc2CriteriaConfig';

describe('SOC2_V1_CRITERIA', () => {
  it('is versioned', () => {
    expect(SOC2_CRITERIA_CONFIG_VERSION).toBe(1);
  });

  it('contains exactly the six approved criteria, in no particular required order but with no extras', () => {
    const ids = SOC2_V1_CRITERIA.map((c) => c.criterionId).sort();
    expect(ids).toEqual(['CC6.1', 'CC6.2', 'CC6.3', 'CC6.6', 'CC7.1', 'CC9.1']);
  });

  it('every criterion is disposition class A_OBSERVABLE in Phase 1', () => {
    for (const c of SOC2_V1_CRITERIA) {
      expect(c.dispositionClass).toBe('A_OBSERVABLE');
    }
  });

  it('CC6.1 scopes exactly EC2/EBS/RDS/Aurora/S3', () => {
    const cc61 = getSoc2CriterionConfig('CC6.1');
    expect(cc61?.scope.sort()).toEqual(['aurora', 'ebs', 'ec2', 'rds', 's3']);
  });

  it('CC6.6 scopes exactly EC2/RDS/Aurora/S3', () => {
    const cc66 = getSoc2CriterionConfig('CC6.6');
    expect(cc66?.scope.sort()).toEqual(['aurora', 'ec2', 'rds', 's3']);
  });

  it('CC9.1 scopes exactly EC2/RDS/Aurora (not S3 -- S3 has no traditional backup concept)', () => {
    const cc91 = getSoc2CriterionConfig('CC9.1');
    expect(cc91?.scope.sort()).toEqual(['aurora', 'ec2', 'rds']);
  });

  it('CC6.2 scopes IAM users only; CC6.3 scopes IAM access keys only; CC7.1 scopes security groups only', () => {
    expect(getSoc2CriterionConfig('CC6.2')?.scope).toEqual(['iam_user']);
    expect(getSoc2CriterionConfig('CC6.3')?.scope).toEqual(['iam_access_key']);
    expect(getSoc2CriterionConfig('CC7.1')?.scope).toEqual(['security_group']);
  });

  it('CC7.1’s actual CLAIM text (what DevControl asserts, not what it disclaims) never describes this as security/continuous monitoring, detection effectiveness, incident detection, or CC7.1 compliance generally', () => {
    // evidenceClaim is the affirmative assertion a future UI/API would show as fact --
    // it must be narrow. limitation is expected to legitimately NAME these broader
    // concepts precisely in order to disclaim them ("...not security monitoring...."),
    // so only evidenceClaim (never limitation) is checked against the prohibited list.
    const cc71 = getSoc2CriterionConfig('CC7.1')!;
    const claim = cc71.evidenceClaim.toLowerCase();
    expect(claim).not.toMatch(/security monitoring/);
    expect(claim).not.toMatch(/continuous(ly)? monitor/);
    expect(claim).not.toMatch(/detection effectiveness/);
    expect(claim).not.toMatch(/incident detection/);
    expect(claim).not.toMatch(/cc7\.1 compliance/);
    // It must be scoped to the narrow, real fact instead.
    expect(claim).toMatch(/unrestricted/i);
    expect(claim).toMatch(/0\.0\.0\.0\/0|::\/0/);

    // The disclaimer (limitation) must actively name and reject the broader framing --
    // its absence would itself be a gap.
    const limitation = cc71.limitation.toLowerCase();
    expect(limitation).toMatch(/not security monitoring/);
    expect(limitation).toMatch(/continuous monitoring/);
    expect(limitation).toMatch(/detection\/response effectiveness/);
    expect(limitation).toMatch(/cc7\.1 compliance generally/);
  });

  it('getSoc2CriterionConfig returns undefined for an unconfigured criterion, never fabricates one', () => {
    expect(getSoc2CriterionConfig('CC3.1')).toBeUndefined();
    expect(getSoc2CriterionConfig('not-a-real-criterion')).toBeUndefined();
  });

  it('no criterion claims Type II, audit, certification, or continuous compliance', () => {
    for (const c of SOC2_V1_CRITERIA) {
      const text = `${c.name} ${c.evidenceClaim} ${c.limitation}`.toLowerCase();
      expect(text).not.toMatch(/type ii/);
      expect(text).not.toMatch(/\baudit\b/);
      expect(text).not.toMatch(/certif/);
      expect(text).not.toMatch(/continuous(ly)? complian/);
      expect(text).not.toMatch(/operating effectiveness/);
    }
  });
});
