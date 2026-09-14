import { CIS_V5_CONTROL_MAPPINGS, getCisMappingForSecurityControlId, cisStandardsArnForRegion } from '../securityHubCisMapping';

describe('CIS v5.0.0 mapping', () => {
  it('every entry is DIRECT, framework "cis", version "5.0.0" — no speculative PCI/NIST/SOC2 entries', () => {
    for (const m of CIS_V5_CONTROL_MAPPINGS) {
      expect(m.framework).toBe('cis');
      expect(m.frameworkVersion).toBe('5.0.0');
      expect(m.mappingType).toBe('DIRECT');
    }
  });

  it('contains the well-known EC2.53/EC2.54, IAM.5, IAM.3 controls matching the existing DevControl-scanner mapping', () => {
    expect(getCisMappingForSecurityControlId('EC2.53')?.controlId).toBe('5.3');
    expect(getCisMappingForSecurityControlId('EC2.54')?.controlId).toBe('5.4');
    expect(getCisMappingForSecurityControlId('IAM.5')?.controlId).toBe('1.9');
    expect(getCisMappingForSecurityControlId('IAM.3')?.controlId).toBe('1.13');
  });

  it('an unmapped Security Hub control id returns null rather than a guessed mapping', () => {
    expect(getCisMappingForSecurityControlId('NotARealControl.999')).toBeNull();
  });

  it('has no duplicate securityHubControlId entries', () => {
    const ids = CIS_V5_CONTROL_MAPPINGS.map((m) => m.securityHubControlId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cisStandardsArnForRegion builds the exact verified v5.0.0 ARN format', () => {
    expect(cisStandardsArnForRegion('us-east-1')).toBe(
      'arn:aws:securityhub:us-east-1::standards/cis-aws-foundations-benchmark/v/5.0.0'
    );
  });
});
