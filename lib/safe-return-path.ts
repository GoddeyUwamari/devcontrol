/**
 * Where to send a user after they sign in, taken from a `from` value that
 * anyone can put in a link. Only a path on this site is accepted; anything
 * that could make the browser leave it (an open redirect) is rejected and the
 * caller falls back to its default.
 *
 * Rejected: anything not starting with a single "/", a protocol-relative
 * start ("//host", "/\host" -- browsers treat "\" as "/"), any backslash or
 * control character (browsers drop tab and newline, so "/\t/host" becomes
 * "//host"), and any of these hidden behind percent-encoding, which is
 * decoded repeatedly before checking. Each form is also resolved as the
 * browser would: it must stay on this origin, and its path must not become
 * protocol-relative once dot segments are removed ("/..//host" and
 * "/%2e%2e//host" resolve to "//host", which the router turns back into a
 * link to another site).
 *
 * The result is the resolved path (pathname + search + hash), never the raw
 * input.
 */

export const DEFAULT_RETURN_PATH = "/dashboard";

/** Long enough for any real path; longer values are not worth parsing. */
const MAX_LENGTH = 2048;

/** Decoding rounds; deeper nesting than this is rejected outright. */
const MAX_DECODE_ROUNDS = 3;

const FORBIDDEN_CHARACTER = /[\u0000-\u001f\u007f\\]/;

/** Placeholder origin for resolving a candidate path; never contacted. */
const PLACEHOLDER_ORIGIN = "https://return-path.invalid";

function isSafeForm(candidate: string): boolean {
  return (
    candidate.startsWith("/") &&
    !candidate.startsWith("//") &&
    !FORBIDDEN_CHARACTER.test(candidate)
  );
}

/**
 * The candidate resolved against this site, as pathname + search + hash, or
 * null if it leaves the origin or its path is protocol-relative.
 */
function resolvePath(candidate: string): string | null {
  let url: URL;
  try {
    url = new URL(candidate, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) return null;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (decodedPath.startsWith("//") || decodedPath.startsWith("/\\")) return null;
  return url.pathname + url.search + url.hash;
}

/** The value as a normalized same-origin path, or null if it is not one. */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) {
    return null;
  }

  // Check the value and every decoded form of it, as written and as resolved.
  let candidate = value;
  for (let round = 0; ; round++) {
    if (!isSafeForm(candidate) || resolvePath(candidate) === null) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      return null;
    }
    if (decoded === candidate) break;
    if (round >= MAX_DECODE_ROUNDS) return null;
    candidate = decoded;
  }

  return resolvePath(value);
}
