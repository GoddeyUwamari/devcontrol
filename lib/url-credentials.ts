/**
 * Reads credentials that arrive in the page URL (SSO hand-off, password-reset
 * links) and removes them from the address bar before returning, so nothing
 * that runs afterwards -- a network request, analytics, error reporting, a
 * later navigation -- can see them in `location` or in the history entry.
 *
 * Credentials are read only from the URL fragment (`#token=...`), which the
 * browser never sends to a server. A credential in the query string
 * (`?token=...`) is never returned, so a link of that form signs no one in and
 * reaches no API, but it is removed from the URL and history the same way, so
 * an old link cannot leave it behind. Login and register use this to clear
 * form fields a native GET submit (before hydration) left in the query.
 *
 * Next.js's App Router keeps its own copy of the current URL and writes it
 * back to the address bar on router updates. Its history patch, which keeps
 * that copy in sync with `history.replaceState`, is installed in an effect
 * that runs after a page's own effects on first load. So the URL is cleaned
 * twice: immediately, and again on the next task, through the patch, so the
 * router adopts the clean URL as its own and cannot restore the old one.
 *
 * The router also records the URL the page was loaded with inside its route
 * tree, which it keeps in `history.state` and restores from. Both calls write
 * a copy of that state with the credentials removed, so they do not survive
 * in the history entry or in the tree the router adopts.
 */
export function takeUrlCredentials<K extends string>(
  keys: readonly K[]
): Partial<Record<K, string>> {
  const found: Partial<Record<K, string>> = {};
  if (typeof window === "undefined") return found;

  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  // Query-string values: not returned, only removed (see above).
  const ignored: string[] = [];
  let fragmentHadKey = false;

  for (const key of keys) {
    const value = fragment.get(key);
    if (value) found[key] = value;
    if (fragment.has(key)) {
      fragmentHadKey = true;
      fragment.delete(key);
    }
    ignored.push(...url.searchParams.getAll(key).filter(Boolean));
    url.searchParams.delete(key);
  }

  if (fragmentHadKey) {
    const rest = fragment.toString();
    url.hash = rest ? `#${rest}` : "";
  }

  const clean = url.pathname + url.search + url.hash;
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (clean !== current) {
    const secrets = [...(Object.values(found) as string[]), ...ignored];
    window.history.replaceState(withoutCredentials(window.history.state, current, clean, keys, secrets), "", clean);
    setTimeout(() => {
      if (window.location.pathname + window.location.search + window.location.hash === clean) {
        // No router marker on the state object, so Next's patch treats this as
        // an external URL change: it copies the (already cleaned) route tree
        // from the current entry and updates the router's own URL.
        window.history.replaceState(null, "", clean);
      }
    }, 0);
  }

  return found;
}

/**
 * Values shorter than this are not blanked individually: real credentials are
 * far longer, and blanking a short string would also strip unrelated text
 * (such as the router's own keys) out of the state.
 */
const MIN_SCRUBBED_VALUE_LENGTH = 16;

/** The router's key for a page segment; with search params it is `__PAGE__?<JSON of them>`. */
const PAGE_SEGMENT_KEY = "__PAGE__";

/**
 * A page segment key with the given search params removed, matched by name
 * whatever their value's length; other params keep their order, so the key
 * is the one the router computes for the clean URL. Any other string is
 * returned unchanged.
 */
function withoutSegmentParams(segment: string, keys: readonly string[]): string {
  if (!segment.startsWith(`${PAGE_SEGMENT_KEY}?`)) return segment;
  let params: unknown;
  try {
    params = JSON.parse(segment.slice(PAGE_SEGMENT_KEY.length + 1));
  } catch {
    return segment;
  }
  if (params === null || typeof params !== "object" || Array.isArray(params)) return segment;
  const kept = Object.fromEntries(Object.entries(params).filter(([key]) => !keys.includes(key)));
  return Object.keys(kept).length > 0 ? `${PAGE_SEGMENT_KEY}?${JSON.stringify(kept)}` : PAGE_SEGMENT_KEY;
}

/**
 * A copy of a history state object with the credential params removed from
 * the router's page segment keys, every occurrence of the old URL replaced by
 * the clean one, and any remaining occurrence of a credential value of at
 * least MIN_SCRUBBED_VALUE_LENGTH characters blanked. States that cannot be
 * copied this way are dropped.
 */
function withoutCredentials(
  state: unknown,
  oldPath: string,
  cleanPath: string,
  keys: readonly string[],
  secrets: string[]
): unknown {
  if (state == null) return state;
  try {
    // Operate on the JSON-escaped forms so replacements stay inside strings.
    const escaped = (s: string) => JSON.stringify(s).slice(1, -1);
    const segmentsCleaned = JSON.stringify(state, (_key, value) =>
      typeof value === "string" ? withoutSegmentParams(value, keys) : value
    );
    let json = segmentsCleaned.split(escaped(oldPath)).join(escaped(cleanPath));
    for (const secret of secrets) {
      if (secret.length < MIN_SCRUBBED_VALUE_LENGTH) continue;
      json = json.split(escaped(secret)).join("");
    }
    return JSON.parse(json);
  } catch {
    return null;
  }
}
