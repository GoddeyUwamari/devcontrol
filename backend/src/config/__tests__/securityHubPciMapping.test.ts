import {
  PCI_V4_CONTROL_MAPPINGS,
  PCI_V4_NOT_ESTABLISHABLE_REQUIREMENTS,
  PCI_DSS_VERSION,
  getPciMappingsForSecurityControlId,
  pciStandardsArnForRegion,
} from '../securityHubPciMapping';

describe('PCI DSS v4.0.1 mapping', () => {
  it('is pinned to exactly v4.0.1, framework "pci" -- never v3.2.1', () => {
    expect(PCI_DSS_VERSION).toBe('4.0.1');
    for (const m of PCI_V4_CONTROL_MAPPINGS) {
      expect(m.framework).toBe('pci');
      expect(m.frameworkVersion).toBe('4.0.1');
    }
    for (const r of PCI_V4_NOT_ESTABLISHABLE_REQUIREMENTS) {
      expect(r.frameworkVersion).toBe('4.0.1');
    }
  });

  it('contains no v3.2.1 entries anywhere in the file (source-level contamination check)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../securityHubPciMapping.ts'), 'utf8');
    // Only acceptable mentions of "3.2.1" are inside comments explaining it's OUT OF
    // SCOPE -- no mapping entry (pciRequirementId/frameworkVersion field value) may
    // contain it. Check the actual data arrays' literal content, not the whole file
    // (which legitimately discusses v3.2.1 in prose to explain why it's excluded).
    const mappingEntriesText = source.slice(
      source.indexOf('export const PCI_V4_CONTROL_MAPPINGS'),
      source.indexOf('export function getPciMappingsForSecurityControlId')
    );
    expect(mappingEntriesText).not.toContain('3.2.1');
    expect(mappingEntriesText).not.toContain("frameworkVersion: '3.2.1'");
  });

  it('has no duplicate (securityHubControlId, pciRequirementId) pairs', () => {
    const seen = new Set<string>();
    for (const m of PCI_V4_CONTROL_MAPPINGS) {
      const key = `${m.securityHubControlId}::${m.pciRequirementId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('represents one entry per (Security Hub control, PCI requirement) pair -- a control mapping to multiple requirements produces multiple entries', () => {
    // IAM.3 is individually verified (AWS docs) to satisfy two distinct PCI v4.0.1
    // requirements -- this is the one-to-many cardinality case.
    const iam3Entries = PCI_V4_CONTROL_MAPPINGS.filter((m) => m.securityHubControlId === 'IAM.3');
    expect(iam3Entries.length).toBeGreaterThanOrEqual(2);
    expect(new Set(iam3Entries.map((e) => e.pciRequirementId)).size).toBe(iam3Entries.length);
  });

  it('represents many-to-one cardinality -- multiple Security Hub controls supporting the same PCI requirement', () => {
    // IAM.6, IAM.9, IAM.19 all independently satisfy PCI 8.4.2 (verified from AWS docs).
    const requirement842 = PCI_V4_CONTROL_MAPPINGS.filter((m) => m.pciRequirementId === '8.4.2');
    const distinctControls = new Set(requirement842.map((m) => m.securityHubControlId));
    expect(distinctControls.size).toBeGreaterThanOrEqual(3);
  });

  it('every entry is explicitly classified DIRECT or ADDITIONAL_EVIDENCE -- both classifications are actually used', () => {
    const types = new Set(PCI_V4_CONTROL_MAPPINGS.map((m) => m.mappingType));
    expect(types.has('DIRECT')).toBe(true);
    expect(types.has('ADDITIONAL_EVIDENCE')).toBe(true);
    for (const m of PCI_V4_CONTROL_MAPPINGS) {
      expect(['DIRECT', 'ADDITIONAL_EVIDENCE']).toContain(m.mappingType);
    }
  });

  it('getPciMappingsForSecurityControlId returns all matching entries for a multiply-mapped control', () => {
    expect(getPciMappingsForSecurityControlId('IAM.3').length).toBeGreaterThanOrEqual(2);
    expect(getPciMappingsForSecurityControlId('IAM.5').length).toBeGreaterThanOrEqual(1);
  });

  it('an unmapped Security Hub control id returns an empty array rather than a guessed mapping', () => {
    expect(getPciMappingsForSecurityControlId('NotARealControl.999')).toEqual([]);
  });

  it('pciStandardsArnForRegion builds the exact empirically-verified v4.0.1 ARN format', () => {
    expect(pciStandardsArnForRegion('us-east-1')).toBe('arn:aws:securityhub:us-east-1::standards/pci-dss/v/4.0.1');
    expect(pciStandardsArnForRegion('eu-west-1')).toBe('arn:aws:securityhub:eu-west-1::standards/pci-dss/v/4.0.1');
  });

  it('NOT_ESTABLISHABLE requirements are a small, deliberately curated set -- not an enumeration of every unmapped requirement', () => {
    // A sanity bound, not a magic number: this must stay small and explicit, never grow
    // into "every PCI requirement DevControl doesn't map" (see this file's docblock).
    expect(PCI_V4_NOT_ESTABLISHABLE_REQUIREMENTS.length).toBeGreaterThan(0);
    expect(PCI_V4_NOT_ESTABLISHABLE_REQUIREMENTS.length).toBeLessThan(10);
    for (const r of PCI_V4_NOT_ESTABLISHABLE_REQUIREMENTS) {
      expect(r.reason).toBeTruthy();
      expect(r.title).toBeTruthy();
    }
  });

  it('no PCI requirement appears in both the control-backed mapping and the NOT_ESTABLISHABLE set', () => {
    const mappedRequirementIds = new Set(PCI_V4_CONTROL_MAPPINGS.map((m) => m.pciRequirementId));
    for (const r of PCI_V4_NOT_ESTABLISHABLE_REQUIREMENTS) {
      expect(mappedRequirementIds.has(r.pciRequirementId)).toBe(false);
    }
  });
});
