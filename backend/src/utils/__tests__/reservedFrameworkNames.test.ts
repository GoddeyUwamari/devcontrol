import { isReservedFrameworkName, normalizeFrameworkName } from '../reservedFrameworkNames';

describe('isReservedFrameworkName', () => {
  it.each([
    'SOC 2',
    'soc2',
    'SOC2',
    'soc 2 readiness',
    'NIST',
    'nist',
    'NIST 800-53',
    'NIST SP 800-53',
    'CIS',
    'CIS AWS Foundations',
    'cis aws foundations benchmark',
    'CIS AWS Benchmark',
    'PCI',
    'PCI DSS',
    'PCI-DSS',
    'pci_dss',
    'HIPAA',
    'hipaa',
    '  SOC 2  ',
    // Digit/letter lookalike evasion (e.g. "0" for "O").
    'S0C2',
    'S0C 2',
    'N1ST',
    'H1PAA',
    // Spaced-out-letters evasion, with various separators.
    'S O C 2',
    's o c 2',
    'S-O-C-2',
    'S.O.C.2',
    'P C I  D S S',
  ])('rejects the reserved/aliased name "%s"', (name) => {
    expect(isReservedFrameworkName(name)).toBe(true);
  });

  it.each([
    'My Custom Framework',
    'Internal Data Handling Policy',
    'NIST-inspired internal baseline',
    'PCI compliance helper notes',
    'CIS AWS',
    'Security',
    'Compliance Framework',
    '',
    // Superficially close to a reserved alias's leet/spacing evasion, but
    // genuinely different -- must not become a false positive from the fix.
    'NIST 801-53',
    'Team 2024 Baseline',
    'CIS AWS Foundation',
  ])('allows the legitimate custom name "%s"', (name) => {
    expect(isReservedFrameworkName(name)).toBe(false);
  });
});

describe('normalizeFrameworkName', () => {
  it('case-folds and strips separators entirely (not collapsed to a space)', () => {
    expect(normalizeFrameworkName('PCI-DSS')).toBe('pcidss');
    expect(normalizeFrameworkName('PCI_DSS')).toBe('pcidss');
    expect(normalizeFrameworkName('  PCI   DSS  ')).toBe('pcidss');
    expect(normalizeFrameworkName('Pci/Dss')).toBe('pcidss');
  });

  it('replaces digit/letter lookalikes before stripping', () => {
    expect(normalizeFrameworkName('S0C2')).toBe('soc2');
    expect(normalizeFrameworkName('N1ST')).toBe('nist');
    expect(normalizeFrameworkName('H1PAA')).toBe('hipaa');
  });

  it('is unaffected by spacing every letter out', () => {
    expect(normalizeFrameworkName('S O C 2')).toBe('soc2');
    expect(normalizeFrameworkName('S-O-C-2')).toBe('soc2');
  });

  it('leaves digits with no letter lookalike (2, 6, 9) untouched, so distinct numbers stay distinct', () => {
    expect(normalizeFrameworkName('NIST 800-53')).not.toBe(normalizeFrameworkName('NIST 801-53'));
  });
});
