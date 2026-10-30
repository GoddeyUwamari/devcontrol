import {
  checkTagPattern,
  matchTagValue,
  MAX_TAG_PATTERN_LENGTH,
  MAX_TAG_VALUE_LENGTH,
  TagPattern,
} from '../tagPatternMatcher';

const accepted = (pattern: string): TagPattern => {
  const check = checkTagPattern(pattern);
  if (!check.ok) throw new Error(`expected ${JSON.stringify(pattern)} to be accepted, got ${check.problem.reason}`);
  return check.pattern;
};
const refusal = (pattern: unknown) => {
  const check = checkTagPattern(pattern);
  if (check.ok) throw new Error(`expected ${JSON.stringify(pattern)} to be refused`);
  return check.problem;
};
const matches = (pattern: string, value: string) => {
  const result = matchTagValue(accepted(pattern), value);
  if (!result.ok) throw new Error(`value refused: ${result.reason}`);
  return result.matched;
};

describe('checkTagPattern: what is refused, with which code', () => {
  it.each([
    ['(unclosed', 'pattern_invalid', 'INVALID_REGEX_PATTERN'],
    ['abc\\', 'pattern_invalid', 'INVALID_REGEX_PATTERN'],
    ['a{2,1}', 'pattern_invalid', 'INVALID_REGEX_PATTERN'],
    ['[z-a]', 'pattern_invalid', 'INVALID_REGEX_PATTERN'],
    ['(a)\\1', 'pattern_unsupported:backreference', 'UNSUPPORTED_REGEX_PATTERN'],
    ['(?<n>a)\\k<n>', 'pattern_unsupported:backreference', 'UNSUPPORTED_REGEX_PATTERN'],
    ['^(?=prod)', 'pattern_unsupported:lookaround', 'UNSUPPORTED_REGEX_PATTERN'],
    ['^(?!prod)', 'pattern_unsupported:lookaround', 'UNSUPPORTED_REGEX_PATTERN'],
    ['(?<=a)b', 'pattern_unsupported:lookaround', 'UNSUPPORTED_REGEX_PATTERN'],
    ['(?<!a)b', 'pattern_unsupported:lookaround', 'UNSUPPORTED_REGEX_PATTERN'],
    ['\\1', 'pattern_unsupported:legacy_escape', 'UNSUPPORTED_REGEX_PATTERN'],
    ['\\01', 'pattern_unsupported:legacy_escape', 'UNSUPPORTED_REGEX_PATTERN'],
    ['\\8', 'pattern_unsupported:legacy_escape', 'UNSUPPORTED_REGEX_PATTERN'],
    ['\\a', 'pattern_unsupported:legacy_escape', 'UNSUPPORTED_REGEX_PATTERN'],
    ['[\\c]', 'pattern_unsupported:legacy_escape', 'UNSUPPORTED_REGEX_PATTERN'],
    ['[\\d-z]', 'pattern_unsupported:legacy_escape', 'UNSUPPORTED_REGEX_PATTERN'],
    ['team-\u{1F600}', 'pattern_unsupported:astral_char', 'UNSUPPORTED_REGEX_PATTERN'],
    ['\\uD83D', 'pattern_unsupported:astral_char', 'UNSUPPORTED_REGEX_PATTERN'],
    ['x{1001}', 'pattern_too_complex', 'REGEX_PATTERN_TOO_COMPLEX'],
    ['(x{40}){40}', 'pattern_too_complex', 'REGEX_PATTERN_TOO_COMPLEX'],
    ['(?:abc){999}', 'pattern_too_complex', 'REGEX_PATTERN_TOO_COMPLEX'],
    ['(?:a?){999}ab', 'pattern_too_complex', 'REGEX_PATTERN_TOO_COMPLEX'],
    ['a'.repeat(MAX_TAG_PATTERN_LENGTH + 1), 'pattern_too_long', 'REGEX_PATTERN_TOO_LONG'],
  ])('%j -> %s', (pattern, reason, code) => {
    const problem = refusal(pattern);
    expect(problem).toMatchObject({ reason, code });
    // The customer-facing message never repeats the pattern.
    expect(problem.message.includes(pattern)).toBe(false);
  });

  it.each([[''], [undefined], [null], [42], [{ source: 'a' }]])('%p is not a pattern', (pattern) => {
    expect(refusal(pattern)).toMatchObject({ reason: 'pattern_invalid', code: 'INVALID_REGEX_PATTERN', message: 'Pattern must be a non-empty string.' });
  });

  it('names the unsupported feature in the message', () => {
    expect(refusal('(a)\\1').message).toBe("Pattern uses backreferences, which aren't supported in rule patterns. Rewrite the pattern without it.");
    expect(refusal('(?=a)').message).toMatch(/^Pattern uses lookahead or lookbehind,/);
    expect(refusal('x{1001}').message).toBe('Pattern is too complex. Reduce nested or counted repetition.');
    expect(refusal('a'.repeat(201)).message).toBe('Pattern exceeds the maximum allowed length of 200 characters.');
  });

  it('accepts the limits exactly', () => {
    accepted('a'.repeat(MAX_TAG_PATTERN_LENGTH));
    accepted('(?:a?){999}a'); // size 2000
    accepted('x{1000}');
    accepted('(?:x{10}){100}');
  });

  it('accepts patterns a backtracking engine handles badly: the matcher runs in linear time', () => {
    for (const p of ['(a+)+$', '(a|a)*$', '(a|aa)+$', '(\\w|\\d)+$', '^.*.*.*.*.*x$', '(.*a){20}']) accepted(p);
  });
});

describe('matching keeps JavaScript RegExp results (differential, safe patterns only)', () => {
  const PATTERNS = [
    '^(prod|staging|dev)$', '^[a-z0-9-]+$', '^v\\d+\\.\\d+\\.\\d+$', '^[A-Z][a-z]+-\\d{2,4}$', '^\\S+@\\S+\\.\\w+$',
    '[.]', '[^.]+', 'a.b', '^.$', '.*', '\\s', '[\\s]', '[^\\S]', '\\S+', '^\\w+$', '\\W', '\\d{3}', '\\D',
    'a/b', '[]', '[^]', 'x[]*y', 'x[^]y', '\\0', '[\\b]', '\\cJ', 'a{', 'a{,2}', ']', '}', '\\-', '\\$\\^', '\\.',
    '\\x41', '\\u0041', '[\\u00e0-\\u00ff]', '[\\n-\\r]', '\\f\\v\\t', '\\bfoo\\b', '\\B', '^$', 'a|', '(?:)', '()',
    '^(?:a|b)*?c', 'a{2,3}', 'a{2,}', '^a{0}$', '(?<team>team)-\\d', '^[^\\s]*$', '[^a-c]',
  ];
  const VALUES = [
    '', 'a', 'b', 'c', 'ab', 'ac', 'aa', 'aaa', 'abc', 'bbc', 'prod', 'Prod', 'prod\n', 'x', 'xy', 'x\ny', 'x\ry',
    'x y', 'x y', 'x\u0085y', '.', ' ', '\u000b', '﻿', '　', '᠎', '​', 'a b',
    'foo bar', 'foobar', 'v1.2.3', 'v1.2', '123', '12345', '\0', '\b', '\n', '\r', '\t', 'Abc-12', 'é', 'ÿ', ']',
    '}', '-', '$^', 'a{', 'a{,2}', 'A', 'a/b', 'team-7', 'ops@example.com', 'a'.repeat(MAX_TAG_VALUE_LENGTH),
  ];

  it('the same result as RegExp for every pattern x value', () => {
    const differences: string[] = [];
    for (const pattern of PATTERNS) {
      const oracle = new RegExp(pattern); // test oracle only; safe patterns
      const ours = accepted(pattern);
      for (const value of VALUES) {
        const result = matchTagValue(ours, value);
        if (!result.ok || result.matched !== oracle.test(value)) differences.push(`${JSON.stringify(pattern)} on ${JSON.stringify(value)}`);
      }
    }
    expect(differences).toEqual([]);
  });

  it('the same result for every BMP character, for each class escape, `.`, `[]` and `[^]`', () => {
    const differences: string[] = [];
    for (const atom of ['\\s', '\\S', '.', '\\w', '\\W', '\\d', '\\D', '[]', '[^]', '[\\s\\d]', '[^\\s\\w]', '[.]', '[^.]']) {
      const oracle = new RegExp(`^${atom}$`);
      const ours = accepted(`^${atom}$`);
      for (let unit = 0; unit <= 0xffff; unit++) {
        if (unit >= 0xd800 && unit <= 0xdfff) continue;
        const value = String.fromCharCode(unit);
        const result = matchTagValue(ours, value);
        if (!result.ok || result.matched !== oracle.test(value)) differences.push(`${atom} U+${unit.toString(16)}`);
      }
    }
    expect(differences).toEqual([]);
  });

  it('[] never matches and [^] matches any character, newlines included', () => {
    expect(matches('[]', 'anything')).toBe(false);
    expect(matches('x[]*y', 'xy')).toBe(true);
    expect(matches('^[^]$', '\n')).toBe(true);
    expect(matches('^[^]$', '')).toBe(false);
  });
});

describe('matchTagValue: values it refuses rather than guess at', () => {
  const pattern = accepted('^.*$');

  it('a value at the length limit is matched; one past it is refused, never truncated', () => {
    expect(MAX_TAG_VALUE_LENGTH).toBe(256);
    expect(matchTagValue(pattern, 'a'.repeat(MAX_TAG_VALUE_LENGTH))).toEqual({ ok: true, matched: true });
    expect(matchTagValue(accepted('^a{3}'), `aaa${'b'.repeat(MAX_TAG_VALUE_LENGTH - 2)}`)).toMatchObject({ ok: false, reason: 'value_too_long' });
  });

  it('a value with a character outside the BMP, or a lone surrogate, is refused', () => {
    expect(matchTagValue(pattern, 'team-\u{1F600}')).toMatchObject({ ok: false, reason: 'value_unsupported_chars' });
    expect(matchTagValue(pattern, 'x\uD800')).toMatchObject({ ok: false, reason: 'value_unsupported_chars' });
  });
});

describe('no JavaScript RegExp is built from the pattern', () => {
  it('checking and matching construct no RegExp whose source contains the pattern', () => {
    const marker = 'zq7(mark|er)+x';
    const sources: string[] = [];
    const Original = global.RegExp;
    global.RegExp = new Proxy(Original, {
      construct(target, args) {
        sources.push(String(args[0]));
        return Reflect.construct(target, args);
      },
      apply(target, thisArg, args) {
        sources.push(String(args[0]));
        return Reflect.apply(target, thisArg, args);
      },
    });
    try {
      const ours = accepted(marker);
      expect(matchTagValue(ours, 'zq7markerx')).toEqual({ ok: true, matched: true });
    } finally {
      global.RegExp = Original;
    }
    expect(sources.filter((s) => s.includes('mark|er'))).toEqual([]);
  });

  it('compiling many patterns at the size limit stays fast', () => {
    const start = Date.now();
    for (let i = 0; i < 100; i++) accepted('(?:a?){999}a');
    expect(Date.now() - start).toBeLessThan(5_000);
  });
});
