/**
 * Matching for customer-authored `tag_pattern` rules. The same check runs when
 * a rule is saved (compliance-frameworks.controller.ts) and when a scan
 * evaluates it (custom-compliance.service.ts), so a rule saved before this
 * check existed is held to it too.
 *
 * A pattern is written in JavaScript regex syntax (no flags), but it is never
 * run as a JavaScript RegExp. It is parsed into an AST (regexp-tree, parse
 * only), every node is checked against the list of supported constructs, and
 * an RE2 pattern with the same meaning is generated and run by re2js, whose
 * matching time grows linearly with the input. Anything that can't be
 * translated exactly is refused with a reason; there is no fallback.
 *
 * JavaScript meaning kept by the generator: `.` excludes \n \r    ;
 * `\s` is JavaScript's whitespace set (RE2's is ASCII only); `[]` matches
 * nothing and `[^]` any character. Refused: backreferences, lookaround,
 * legacy (Annex B) escapes such as `\1` octal or `\a` identity escapes, and
 * characters outside the Basic Multilingual Plane, which JavaScript (no `u`
 * flag) matches as two code units and RE2 as one code point. For the same
 * reason a tag value containing such a character can't be evaluated.
 *
 * Bounds: the pattern's length, its size once counted repetitions are
 * expanded, and the tag value's length. Together they bound the cost of one
 * evaluation.
 */
import { parse } from 'regexp-tree';
import type { AstRegExp, Char, CharacterClass, ClassRange, Expression } from 'regexp-tree/ast';
import { RE2JS } from 're2js';

export const MAX_TAG_PATTERN_LENGTH = 200;
/** The pattern's size with counted repetitions expanded (`(ab){10}` is 21). */
export const MAX_TAG_PATTERN_COMPLEXITY = 2000;
export const MAX_TAG_VALUE_LENGTH = 1024;
/** RE2's limit on a counted repetition, and on nested counts multiplied together. */
const MAX_REPEAT_COUNT = 1000;

export type UnsupportedFeature = 'backreference' | 'lookaround' | 'legacy_escape' | 'astral_char' | 'engine';

/** Logged with the rule; never shown with the pattern text. */
export type TagPatternReason =
  | 'pattern_invalid'
  | 'pattern_too_long'
  | 'pattern_too_complex'
  | `pattern_unsupported:${UnsupportedFeature}`;

export type TagPatternErrorCode =
  | 'INVALID_REGEX_PATTERN'
  | 'UNSUPPORTED_REGEX_PATTERN'
  | 'REGEX_PATTERN_TOO_COMPLEX'
  | 'REGEX_PATTERN_TOO_LONG';

export interface TagPatternProblem {
  reason: TagPatternReason;
  /** The save-time response's `code`. */
  code: TagPatternErrorCode;
  /** Customer-facing: the save-time error, and the scan finding after "Couldn't evaluate: ". */
  message: string;
}

/** A pattern that passed the check, ready to match tag values. */
export interface TagPattern {
  readonly engine: RE2JS;
}

export type TagPatternCheck = { ok: true; pattern: TagPattern } | { ok: false; problem: TagPatternProblem };

export type TagValueReason = 'value_too_long' | 'value_unsupported_chars' | 'evaluation_failed';

export type TagValueMatch =
  | { ok: true; matched: boolean }
  | { ok: false; reason: TagValueReason; message: string };

const FEATURE_TEXT: Record<UnsupportedFeature, string> = {
  backreference: 'backreferences',
  lookaround: 'lookahead or lookbehind',
  legacy_escape: 'legacy escapes',
  astral_char: 'characters outside the Basic Multilingual Plane',
  engine: 'a construct that can\'t be evaluated',
};

const invalid = (): TagPatternProblem => ({
  reason: 'pattern_invalid',
  code: 'INVALID_REGEX_PATTERN',
  message: 'Pattern is not a valid regular expression.',
});

const tooComplex = (): TagPatternProblem => ({
  reason: 'pattern_too_complex',
  code: 'REGEX_PATTERN_TOO_COMPLEX',
  message: 'Pattern is too complex. Reduce nested or counted repetition.',
});

const unsupported = (feature: UnsupportedFeature): TagPatternProblem => ({
  reason: `pattern_unsupported:${feature}`,
  code: 'UNSUPPORTED_REGEX_PATTERN',
  message: `Pattern uses ${FEATURE_TEXT[feature]}, which aren't supported in rule patterns. Rewrite the pattern without it.`,
});

/** Thrown inside the walk and caught by checkTagPattern; never escapes this module. */
class Refused extends Error {
  constructor(readonly problem: TagPatternProblem) {
    super(problem.reason);
  }
}

type Range = [number, number];

const MAX_CODE_POINT = 0x10ffff;
const DIGIT: Range[] = [[0x30, 0x39]];
const WORD: Range[] = [[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]];
/** JavaScript's \s: WhiteSpace and LineTerminator (ECMA-262). */
const WHITESPACE: Range[] = [
  [0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a],
  [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff],
];
/** What JavaScript's `.` excludes (no `s` flag). */
const LINE_TERMINATORS: Range[] = [[0x0a, 0x0a], [0x0d, 0x0d], [0x2028, 0x2029]];

/** Sorted, merged ranges. */
function normalize(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const [lo, hi] of sorted) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  return merged;
}

function complement(ranges: Range[]): Range[] {
  const out: Range[] = [];
  let next = 0;
  for (const [lo, hi] of normalize(ranges)) {
    if (lo > next) out.push([next, lo - 1]);
    next = hi + 1;
  }
  if (next <= MAX_CODE_POINT) out.push([next, MAX_CODE_POINT]);
  return out;
}

const hex = (cp: number) => `\\x{${cp.toString(16)}}`;

/** An RE2 class matching exactly these code points; an empty set never matches. */
function emitClass(ranges: Range[]): string {
  const set = normalize(ranges);
  if (set.length === 0) return `[^${hex(0)}-${hex(MAX_CODE_POINT)}]`;
  return `[${set.map(([lo, hi]) => (lo === hi ? hex(lo) : `${hex(lo)}-${hex(hi)}`)).join('')}]`;
}

/** The code point of a Char that stands for one character, refusing anything JavaScript and RE2 read differently. */
function codePointOf(char: Char, inClass: boolean): number {
  let cp: number | null;
  switch (char.kind) {
    case 'simple':
      // An escaped letter or digit read as itself (`\a`, `\k`, `\c`) is an
      // Annex B identity escape; the parser and V8 don't agree on all of them.
      if (char.escaped && /^[A-Za-z0-9]$/.test(char.value)) throw new Refused(unsupported('legacy_escape'));
      cp = char.codePoint;
      break;
    case 'hex':
    case 'unicode':
      cp = char.codePoint;
      break;
    case 'control': {
      const letter = /^\\c([A-Za-z])$/.exec(char.value);
      if (!letter) throw new Refused(unsupported('legacy_escape'));
      cp = letter[1].charCodeAt(0) % 32;
      break;
    }
    case 'decimal':
      // Only \0 means the same in both; \1-\9 without a group are legacy octal or literal digits.
      if (char.value !== '\\0') throw new Refused(unsupported('legacy_escape'));
      cp = 0;
      break;
    case 'meta':
      // \n \r \t \v \f carry their code point; in a class, \b is backspace.
      cp = inClass && char.value === '\\b' ? 0x08 : char.codePoint;
      break;
    default:
      throw new Refused(unsupported('legacy_escape'));
  }
  if (cp === null || cp === undefined) throw new Refused(invalid());
  if (cp > 0xffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new Refused(unsupported('astral_char'));
  return cp;
}

/** The set a class escape or `.` stands for, or null when the Char is a single character. */
function setOf(char: Char): Range[] | null {
  if (char.kind !== 'meta') return null;
  switch (char.value) {
    case '.': return complement(LINE_TERMINATORS);
    case '\\d': return DIGIT;
    case '\\D': return complement(DIGIT);
    case '\\w': return WORD;
    case '\\W': return complement(WORD);
    case '\\s': return WHITESPACE;
    case '\\S': return complement(WHITESPACE);
    default: return null;
  }
}

function classRanges(node: CharacterClass): Range[] {
  const ranges: Range[] = [];
  for (const item of node.expressions as (Char | ClassRange)[]) {
    if (item.type === 'ClassRange') {
      // A class escape as an endpoint (`[\d-z]`) is Annex B syntax.
      if (setOf(item.from) || setOf(item.to)) throw new Refused(unsupported('legacy_escape'));
      const lo = codePointOf(item.from, true);
      const hi = codePointOf(item.to, true);
      if (lo > hi) throw new Refused(invalid());
      ranges.push([lo, hi]);
    } else {
      const set = item.value === '.' ? null : setOf(item);
      if (set) ranges.push(...set);
      else {
        const cp = codePointOf(item, true);
        ranges.push([cp, cp]);
      }
    }
  }
  return node.negative ? complement(ranges) : ranges;
}

interface Emitted {
  source: string;
  /** Size with counted repetitions expanded. */
  size: number;
}

function emit(node: Expression | null, repeatProduct: number): Emitted {
  if (node === null) return { source: '', size: 0 };
  switch (node.type) {
    case 'Char': {
      const set = setOf(node);
      if (set) return { source: emitClass(set), size: 1 };
      return { source: hex(codePointOf(node, false)), size: 1 };
    }
    case 'CharacterClass':
      return { source: emitClass(classRanges(node)), size: 1 };
    case 'Alternative': {
      const parts = node.expressions.map((e) => emit(e, repeatProduct));
      return { source: parts.map((p) => p.source).join(''), size: parts.reduce((n, p) => n + p.size, 0) };
    }
    case 'Disjunction': {
      const left = emit(node.left, repeatProduct);
      const right = emit(node.right, repeatProduct);
      return { source: `(?:${left.source}|${right.source})`, size: left.size + right.size + 1 };
    }
    case 'Group': {
      // A boolean match needs no captures: every group is emitted non-capturing.
      const inner = emit(node.expression, repeatProduct);
      return { source: `(?:${inner.source})`, size: Math.max(inner.size, 1) };
    }
    case 'Backreference':
      throw new Refused(unsupported('backreference'));
    case 'Assertion':
      switch (node.kind) {
        case '^':
        case '$':
        case '\\b':
        case '\\B':
          return { source: node.kind, size: 1 };
        default:
          throw new Refused(unsupported('lookaround'));
      }
    case 'Repetition': {
      const q = node.quantifier;
      const lazy = q.greedy ? '' : '?';
      if (q.kind !== 'Range') {
        const inner = emit(node.expression, repeatProduct);
        return { source: `(?:${inner.source})${q.kind}${lazy}`, size: inner.size + 1 };
      }
      const count = q.to ?? q.from;
      const product = repeatProduct * Math.max(count, 1);
      if (count > MAX_REPEAT_COUNT || product > MAX_REPEAT_COUNT) throw new Refused(tooComplex());
      const inner = emit(node.expression, product);
      const bounds = q.to === undefined ? `{${q.from},}` : q.to === q.from ? `{${q.from}}` : `{${q.from},${q.to}}`;
      const copies = q.to === undefined ? q.from + 1 : q.to;
      return { source: `(?:${inner.source})${bounds}${lazy}`, size: Math.max(inner.size, 1) * Math.max(copies, 1) + 1 };
    }
    default:
      throw new Refused(invalid());
  }
}

/** A `/`-delimited literal for the parser: an unescaped `/` would end it early. */
function asLiteral(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) {
      out += c + pattern[++i];
    } else {
      out += c === '/' ? '\\/' : c;
    }
  }
  return `/${out}/`;
}

/** The single check for a tag_pattern rule's pattern, at save time and at scan time. */
export function checkTagPattern(pattern: unknown): TagPatternCheck {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return { ok: false, problem: { ...invalid(), message: 'Pattern must be a non-empty string.' } };
  }
  if (pattern.length > MAX_TAG_PATTERN_LENGTH) {
    return {
      ok: false,
      problem: {
        reason: 'pattern_too_long',
        code: 'REGEX_PATTERN_TOO_LONG',
        message: `Pattern exceeds the maximum allowed length of ${MAX_TAG_PATTERN_LENGTH} characters.`,
      },
    };
  }

  let ast: AstRegExp;
  try {
    ast = parse(asLiteral(pattern));
  } catch {
    return { ok: false, problem: invalid() };
  }

  let emitted: Emitted;
  try {
    emitted = emit(ast.body, 1);
  } catch (error) {
    if (error instanceof Refused) return { ok: false, problem: error.problem };
    return { ok: false, problem: invalid() };
  }
  if (emitted.size > MAX_TAG_PATTERN_COMPLEXITY) return { ok: false, problem: tooComplex() };

  try {
    return { ok: true, pattern: { engine: RE2JS.compile(emitted.source) } };
  } catch {
    return { ok: false, problem: unsupported('engine') };
  }
}

/** Matches one tag value. Never truncates, and never guesses at a value it can't read the same way as JavaScript. */
export function matchTagValue(pattern: TagPattern, value: string): TagValueMatch {
  if (value.length > MAX_TAG_VALUE_LENGTH) {
    return { ok: false, reason: 'value_too_long', message: `the tag value is longer than ${MAX_TAG_VALUE_LENGTH} characters` };
  }
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdfff) {
      return {
        ok: false,
        reason: 'value_unsupported_chars',
        message: 'the tag value contains characters outside the Basic Multilingual Plane',
      };
    }
  }
  try {
    return { ok: true, matched: pattern.engine.test(value) };
  } catch {
    return { ok: false, reason: 'evaluation_failed', message: 'the pattern could not be evaluated' };
  }
}
