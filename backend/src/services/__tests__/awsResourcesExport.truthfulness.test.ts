/**
 * Security Truthfulness #40: the "Security Status" CSV export column previously used
 * `if (r.is_encrypted) return '✓ Encrypted'` -- bare JS truthiness, so a null (unknown)
 * resource fell through to `'✗ Not Encrypted'`, fabricating a negative claim in an
 * exported, customer-facing artifact. true/false branches and their precedence against
 * is_public are unchanged; only the new null branch is added.
 */
import { AWSResourcesExportService } from '../awsResourcesExport.service';

describe('AWSResourcesExportService — Security Status column truthiness safety', () => {
  const formatter = (AWSResourcesExportService as any).COLUMN_MAPPINGS.security.formatter;

  it('is_encrypted === true -> "✓ Encrypted" (unchanged)', () => {
    expect(formatter({ is_encrypted: true, is_public: false })).toBe('✓ Encrypted');
  });

  it('is_encrypted === false and is_public -> "⚠ Public" (unchanged precedence)', () => {
    expect(formatter({ is_encrypted: false, is_public: true })).toBe('⚠ Public');
  });

  it('is_encrypted === false and not public -> "✗ Not Encrypted" (unchanged)', () => {
    expect(formatter({ is_encrypted: false, is_public: false })).toBe('✗ Not Encrypted');
  });

  it('is_encrypted === null (unknown) and not public -> an explicit "Unknown" label, never "✗ Not Encrypted"', () => {
    const result = formatter({ is_encrypted: null, is_public: false });
    expect(result).not.toBe('✗ Not Encrypted');
    expect(result).toMatch(/unknown/i);
  });

  it('is_encrypted === null and public -> still surfaces the public warning, not a fabricated encryption claim', () => {
    const result = formatter({ is_encrypted: null, is_public: true });
    expect(result).toBe('⚠ Public');
  });
});

describe('AWSResourcesExportService — Compliance Issues column counts current findings only', () => {
  const formatter = (AWSResourcesExportService as any).COLUMN_MAPPINGS.compliance.formatter;
  const real = { severity: 'high', category: 'public_access', issue: 'EC2 instance has a public IP address', recommendation: 'r' };
  const legacyHipaa = { severity: 'critical', category: 'backups', issue: 'HIPAA: Resource lacks documented backup retention policy', recommendation: 'r' };
  const legacySoc2 = { severity: 'high', category: 'tagging', issue: 'Tagging: IAM role/owner not documented', recommendation: 'r' };
  const unverified = { severity: 'critical', category: 'public_access', issue: 'S3 bucket policy allows public access', recommendation: 'r', findingKey: 's3.public_access.policy', verification: 'unverified' };
  const failedFramework = { ...legacyHipaa, framework: 'HIPAA', findingKey: 'hipaa.automated_backups', applicability: 'enabled', evaluation_state: 'failed' };

  it.each([
    ['current findings are counted (unchanged)', [real, { ...real, issue: 'other' }], '2 issues'],
    ['one current finding is singular (unchanged)', [real], '1 issue'],
    ['a failed check of an enabled framework is counted', [failedFramework], '1 issue'],
    ['legacy HIPAA and SOC 2 entries are not counted', [legacyHipaa, legacySoc2], 'No issues'],
    ['an S3 finding carried forward unverified is not counted', [unverified], 'No issues'],
    ['only the current finding among entries that are not', [legacyHipaa, real, legacySoc2, unverified], '1 issue'],
    ['an empty array', [], 'No issues'],
    ['a missing value', null, 'No issues'],
    ['a value that is not an array', { severity: 'high' }, 'No issues'],
  ])('%s', (_name, compliance_issues, expected) => {
    expect(formatter({ compliance_issues })).toBe(expected);
  });
});

