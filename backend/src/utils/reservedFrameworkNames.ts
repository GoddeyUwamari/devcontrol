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

// Digit/letter lookalikes seen in real-world evasion attempts (e.g. "S0C2"
// for "SOC2"). Each target letter is distinct, so this never collapses two
// different digit sequences into the same output -- "NIST 800-53" and
// "NIST 801-53" still normalize to different strings; it just also catches
// the disguised spelling of an already-reserved name. Digits with no common
// letter lookalike (2, 6, 9) are left as-is.
const LEET_SUBSTITUTIONS: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
};

/**
 * Deterministic normalization: case-fold, replace digit/letter lookalikes,
 * then strip every character that isn't a letter or digit. Stripping
 * (rather than collapsing to a single space) means separator choice
 * (hyphen/underscore/slash/space) and even spacing every letter out
 * ("S O C 2") can't change the result. This is still an exact-match
 * comparison key, not a substring/fuzzy one -- isReservedFrameworkName below
 * only ever does a Set.has() equality check against the *entire* normalized
 * name, so "PCI compliance helper notes" normalizes to something other than
 * "pci" and is still never blocked for merely mentioning a standard.
 */
export function normalizeFrameworkName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[0-9]/g, (d) => LEET_SUBSTITUTIONS[d] ?? d)
    .replace(/[^a-z0-9]/g, '');
}

const RESERVED_NORMALIZED = new Set(RESERVED_ALIASES.map(normalizeFrameworkName));

export function isReservedFrameworkName(name: string): boolean {
  return RESERVED_NORMALIZED.has(normalizeFrameworkName(name));
}
