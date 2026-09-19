/**
 * Bounds the risk of a customer-authored `tag_pattern` rule's regex being
 * evaluated (via `new RegExp(pattern).test(tagValue)`) against every scanned
 * resource's tag values. Two independent, deterministic guards -- neither
 * alone is trusted:
 *
 *  - a maximum source length, since a pathological pattern's complexity is
 *    bounded by how much of it there is to nest;
 *  - `safe-regex` (backed by `regexp-tree`'s AST parser), a static analyzer
 *    that rejects patterns whose worst-case backtracking is exponential --
 *    not a blacklist of specific substrings/characters, which a trivially
 *    different-looking pattern could defeat.
 *
 * This is deliberately NOT "reject if it merely looks short/simple" -- a
 * short pattern can still be catastrophic (e.g. `(a+)+$`, 6 characters).
 */
import safeRegex from 'safe-regex';

export const MAX_TAG_PATTERN_LENGTH = 200;

export type TagPatternSafetyResult =
  | { safe: true }
  | { safe: false; reason: string };

export function assessTagPatternSafety(pattern: string): TagPatternSafetyResult {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return { safe: false, reason: 'Pattern must be a non-empty string' };
  }

  if (pattern.length > MAX_TAG_PATTERN_LENGTH) {
    return {
      safe: false,
      reason: `Pattern exceeds the maximum allowed length of ${MAX_TAG_PATTERN_LENGTH} characters`,
    };
  }

  let compiled: RegExp;
  try {
    compiled = new RegExp(pattern);
  } catch {
    return { safe: false, reason: 'Pattern is not a valid regular expression' };
  }

  if (!safeRegex(compiled)) {
    return {
      safe: false,
      reason: 'Pattern is not accepted: it may cause catastrophic backtracking (exponential-time evaluation)',
    };
  }

  return { safe: true };
}
