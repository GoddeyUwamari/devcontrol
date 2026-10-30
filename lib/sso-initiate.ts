/**
 * Where the login page sends the browser to start SSO, from the answer of
 * GET /api/auth/saml/check-domain.
 *
 * The backend answers `{ hasSSO: true, initiatePath }`, a path on the API.
 * Only a path to the SSO start endpoint is followed, so a response body can
 * never send the browser anywhere else.
 *
 * TEMPORARY: a backend deployed before this change answers
 * `{ hasSSO: true, organizationId }` instead. Until both are deployed, an
 * organization id (a UUID, nothing else) still starts SSO the old way.
 * Remove the fallback once the backend that returns initiatePath is live.
 */
const INITIATE_PATH_PREFIX = "/api/auth/saml/initiate?";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ssoInitiateUrl(api: string, data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const { initiatePath, organizationId } = data as Record<string, unknown>;

  if (typeof initiatePath === "string" && initiatePath.startsWith(INITIATE_PATH_PREFIX)) {
    return `${api}${initiatePath}`;
  }
  if (initiatePath === undefined && typeof organizationId === "string" && UUID.test(organizationId)) {
    return `${api}/api/auth/saml/initiate?orgId=${organizationId}`;
  }
  return null;
}

/** Sends the browser to the SSO start URL (it redirects on to the identity provider). */
export function goToSso(url: string): void {
  window.location.href = url;
}
