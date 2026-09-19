import { assessTagPatternSafety, MAX_TAG_PATTERN_LENGTH } from '../regexSafety';

describe('assessTagPatternSafety', () => {
  it('accepts realistic, safe tag-value patterns', () => {
    expect(assessTagPatternSafety('^(prod|staging|dev)$')).toEqual({ safe: true });
    expect(assessTagPatternSafety('^[a-z0-9-]+$')).toEqual({ safe: true });
    expect(assessTagPatternSafety('^v\\d+\\.\\d+\\.\\d+$')).toEqual({ safe: true });
  });

  it('rejects a known catastrophic-backtracking pattern, even though it is short', () => {
    const result = assessTagPatternSafety('(a+)+$');
    expect(result.safe).toBe(false);
    if (!result.safe) expect(result.reason).toMatch(/catastrophic backtracking/);
  });

  it('rejects another classic exponential-time pattern', () => {
    const result = assessTagPatternSafety('([a-zA-Z]+)*$');
    expect(result.safe).toBe(false);
  });

  it('rejects a pattern exceeding the maximum length, regardless of content', () => {
    const longButOtherwiseSafe = '^' + 'a'.repeat(MAX_TAG_PATTERN_LENGTH) + '$';
    const result = assessTagPatternSafety(longButOtherwiseSafe);
    expect(result.safe).toBe(false);
    if (!result.safe) expect(result.reason).toMatch(/maximum allowed length/);
  });

  it('rejects an invalid regular expression', () => {
    const result = assessTagPatternSafety('(unclosed');
    expect(result.safe).toBe(false);
    if (!result.safe) expect(result.reason).toMatch(/not a valid regular expression/);
  });

  it('rejects an empty pattern', () => {
    expect(assessTagPatternSafety('').safe).toBe(false);
  });

  it('does not treat a short pattern as safe merely because it is short', () => {
    // A short pattern is not automatically trusted -- (a+)+ above is 6
    // characters and still rejected. This test documents that guarantee
    // explicitly rather than relying on the other cases to imply it.
    expect(assessTagPatternSafety('(a+)+$').safe).toBe(false);
  });
});
