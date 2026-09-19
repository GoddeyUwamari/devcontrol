/**
 * Guards against a customer-authored compliance framework impersonating an
 * officially-branded standard DevControl already presents elsewhere (Security
 * Hub-backed CIS/PCI/NIST, or SOC 2 Readiness). Comparison is by normalized
 * exact/alias match only -- never a substring check -- so a legitimate custom
 * name like "NIST-inspired internal baseline" or "PCI compliance helper notes"
 * is never blocked merely for mentioning a standard's name.
 */

const RESERVED_ALIASES = [
  'SOC 2',
  'SOC2',
  'SOC 2 READINESS',
  'NIST',
  'NIST 800-53',
  'NIST SP 800-53',
  'CIS',
  'CIS AWS FOUNDATIONS',
  'CIS AWS FOUNDATIONS BENCHMARK',
  'CIS AWS BENCHMARK',
  'PCI',
  'PCI DSS',
  'PCI-DSS',
  'HIPAA',
] as const;

/**
 * Deterministic normalization: trim, case-fold, collapse separator forms
 * (hyphen/underscore/slash treated as whitespace, matching how these aliases
 * are written interchangeably in practice, e.g. "PCI-DSS" vs "PCI DSS"), then
 * collapse repeated whitespace.
 */
export function normalizeFrameworkName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ');
}

const RESERVED_NORMALIZED = new Set(RESERVED_ALIASES.map(normalizeFrameworkName));

export function isReservedFrameworkName(name: string): boolean {
  return RESERVED_NORMALIZED.has(normalizeFrameworkName(name));
}
