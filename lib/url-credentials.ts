/**
 * Reads credentials that arrive in the page URL (SSO hand-off, password-reset
 * links) and removes them from the address bar before returning, so nothing
 * that runs afterwards -- a network request, analytics, error reporting, a
 * later navigation -- can see them in `location` or in the history entry.
 *
 * Credentials are expected in the URL fragment (`#token=...`), which the
 * browser never sends to a server. The query string (`?token=...`) is also
 * read, for links issued before the fragment was used; it is removed the same
 * way. Remove the query-string fallback on or after 2026-10-17.
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
  let fragmentHadKey = false;

  for (const key of keys) {
    const fromFragment = fragment.get(key);
    // Query-string fallback: remove on or after 2026-10-17 (see above).
    const fromQuery = url.searchParams.get(key);
    const value = fromFragment || fromQuery;
    if (value) found[key] = value;
    if (fragment.has(key)) {
      fragmentHadKey = true;
      fragment.delete(key);
    }
    url.searchParams.delete(key);
  }

  if (fragmentHadKey) {
    const rest = fragment.toString();
    url.hash = rest ? `#${rest}` : "";
  }

  const clean = url.pathname + url.search + url.hash;
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (clean !== current) {
    const secrets = Object.values(found) as string[];
    window.history.replaceState(withoutCredentials(window.history.state, current, clean, secrets), "", clean);
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

/**
 * A copy of a history state object with every occurrence of the old URL
 * replaced by the clean one, and any remaining occurrence of a credential
 * value of at least MIN_SCRUBBED_VALUE_LENGTH characters blanked. States that
 * cannot be copied this way are dropped.
 */
function withoutCredentials(state: unknown, oldPath: string, cleanPath: string, secrets: string[]): unknown {
  if (state == null) return state;
  try {
    // Operate on the JSON-escaped forms so replacements stay inside strings.
    const escaped = (s: string) => JSON.stringify(s).slice(1, -1);
    let json = JSON.stringify(state).split(escaped(oldPath)).join(escaped(cleanPath));
    for (const secret of secrets) {
      if (secret.length < MIN_SCRUBBED_VALUE_LENGTH) continue;
      json = json.split(escaped(secret)).join("");
    }
    return JSON.parse(json);
  } catch {
    return null;
  }
}
