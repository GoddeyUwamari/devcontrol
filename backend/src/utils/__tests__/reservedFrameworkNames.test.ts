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
  ])('allows the legitimate custom name "%s"', (name) => {
    expect(isReservedFrameworkName(name)).toBe(false);
  });
});

describe('normalizeFrameworkName', () => {
  it('collapses separators and whitespace, and case-folds', () => {
    expect(normalizeFrameworkName('PCI-DSS')).toBe('pci dss');
    expect(normalizeFrameworkName('PCI_DSS')).toBe('pci dss');
    expect(normalizeFrameworkName('  PCI   DSS  ')).toBe('pci dss');
    expect(normalizeFrameworkName('Pci/Dss')).toBe('pci dss');
  });
});
