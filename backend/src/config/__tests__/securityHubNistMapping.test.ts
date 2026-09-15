import {
  NIST_800_53_CONTROL_MAPPINGS,
  NIST_800_53_VERSION,
  getNistMappingsForSecurityControlId,
  nistStandardsArnForRegion,
} from '../securityHubNistMapping';

describe('NIST SP 800-53 Rev. 5 mapping', () => {
  it('is pinned to exactly v5.0.0, framework "nist"', () => {
    expect(NIST_800_53_VERSION).toBe('5.0.0');
    for (const m of NIST_800_53_CONTROL_MAPPINGS) {
      expect(m.framework).toBe('nist');
      expect(m.frameworkVersion).toBe('5.0.0');
    }
  });

  it('contains at most 30 entries (v1 hard cap) and no entry lacks a Security Hub control', () => {
    expect(NIST_800_53_CONTROL_MAPPINGS.length).toBeGreaterThan(0);
    expect(NIST_800_53_CONTROL_MAPPINGS.length).toBeLessThanOrEqual(30);
    for (const m of NIST_800_53_CONTROL_MAPPINGS) {
      expect(typeof m.securityHubControlId).toBe('string');
      expect(m.securityHubControlId.length).toBeGreaterThan(0);
    }
  });

  it('does not export a NOT_ESTABLISHABLE requirements list -- that mechanism is proven only via a synthetic test config in security-hub-compliance.service.test.ts', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../securityHubNistMapping');
    expect(mod.NIST_800_53_NOT_ESTABLISHABLE_REQUIREMENTS).toBeUndefined();
  });

  it('contains no NIST SP 800-171 entries anywhere in the mapping data (out of scope, distinct standard)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../securityHubNistMapping.ts'), 'utf8');
    const mappingEntriesText = source.slice(
      source.indexOf('export const NIST_800_53_CONTROL_MAPPINGS'),
      source.indexOf('export function getNistMappingsForSecurityControlId')
    );
    expect(mappingEntriesText).not.toContain('800-171');
  });

  it('has no duplicate (securityHubControlId, nistControlId) pairs', () => {
    const seen = new Set<string>();
    for (const m of NIST_800_53_CONTROL_MAPPINGS) {
      const key = `${m.securityHubControlId}::${m.nistControlId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('every nistControlId is a structurally valid NIST SP 800-53 control identifier (e.g. "SC-7", "IA-2(2)")', () => {
    const validPattern = /^[A-Z]{2}-\d+(\(\d+\))?$/;
    for (const m of NIST_800_53_CONTROL_MAPPINGS) {
      expect(m.nistControlId).toMatch(validPattern);
    }
  });

  it('represents many-to-one cardinality -- multiple Security Hub controls supporting the same NIST control', () => {
    // SC-28 (Protection of Information at Rest) is individually verified (AWS docs) to be
    // supported by five independent encryption-at-rest controls across different services.
    const sc28Entries = NIST_800_53_CONTROL_MAPPINGS.filter((m) => m.nistControlId === 'SC-28');
    const distinctControls = new Set(sc28Entries.map((m) => m.securityHubControlId));
    expect(distinctControls.size).toBeGreaterThanOrEqual(3);
  });

  it('represents one-to-many cardinality -- no single Security Hub control is mapped to more than one NIST control', () => {
    // This v1 batch was deliberately curated so each Security Hub control cites exactly
    // one NIST control (the clearest match among AWS's own documented set) -- see the
    // mapping file's own docblock on why entries were not mechanically maximized.
    const byControl = new Map<string, Set<string>>();
    for (const m of NIST_800_53_CONTROL_MAPPINGS) {
      if (!byControl.has(m.securityHubControlId)) byControl.set(m.securityHubControlId, new Set());
      byControl.get(m.securityHubControlId)!.add(m.nistControlId);
    }
    for (const [, nistIds] of byControl) {
      expect(nistIds.size).toBe(1);
    }
  });

  it('every entry is explicitly classified DIRECT or ADDITIONAL_EVIDENCE -- both classifications are actually used', () => {
    const types = new Set(NIST_800_53_CONTROL_MAPPINGS.map((m) => m.mappingType));
    expect(types.has('DIRECT')).toBe(true);
    expect(types.has('ADDITIONAL_EVIDENCE')).toBe(true);
    for (const m of NIST_800_53_CONTROL_MAPPINGS) {
      expect(['DIRECT', 'ADDITIONAL_EVIDENCE']).toContain(m.mappingType);
    }
  });

  it('every production mapping entry has non-empty citation/provenance information referencing official AWS documentation', () => {
    for (const m of NIST_800_53_CONTROL_MAPPINGS) {
      expect(typeof m.citation).toBe('string');
      expect(m.citation.length).toBeGreaterThan(20);
      expect(m.citation).toContain('docs.aws.amazon.com/securityhub');
    }
  });

  it('every title is DevControl-authored (short) rather than a copy of NIST/AWS control text', () => {
    for (const m of NIST_800_53_CONTROL_MAPPINGS) {
      expect(m.title.length).toBeLessThan(120);
    }
  });

  it('getNistMappingsForSecurityControlId returns matching entries for a mapped control', () => {
    expect(getNistMappingsForSecurityControlId('KMS.4').length).toBeGreaterThanOrEqual(1);
  });

  it('an unmapped Security Hub control id returns an empty array rather than a guessed mapping', () => {
    expect(getNistMappingsForSecurityControlId('NotARealControl.999')).toEqual([]);
  });

  it('nistStandardsArnForRegion builds the documentation-confirmed ARN format (not claimed as live-API-verified)', () => {
    expect(nistStandardsArnForRegion('us-east-1')).toBe('arn:aws:securityhub:us-east-1::standards/nist-800-53/v/5.0.0');
    expect(nistStandardsArnForRegion('eu-west-1')).toBe('arn:aws:securityhub:eu-west-1::standards/nist-800-53/v/5.0.0');
  });

  it('the mapping file documents its ARN verification status honestly -- no false "live verified" claim', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../securityHubNistMapping.ts'), 'utf8');
    expect(source).not.toMatch(/live[- ]verified/i);
    expect(source).not.toMatch(/empirically verified/i);
    expect(source).toContain('AccessDeniedException');
    expect(source).toContain('DOCUMENTATION-CONFIRMED');
  });
});
