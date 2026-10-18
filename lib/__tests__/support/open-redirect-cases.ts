/**
 * Return paths that look like same-origin paths but, once dot segments are
 * removed, resolve to a protocol-relative "//evil.example" -- shared by the
 * safeReturnPath unit tests and the login/register redirect tests.
 */
export const DOT_SEGMENT_ESCAPES = [
  "/..//evil.example",
  "/./..//evil.example",
  "/a/..//evil.example",
  "/.//evil.example",
  "/%2e%2e//evil.example",
  "/..%2f/evil.example",
  "/%2e%2e%2f%2fevil.example",
];
