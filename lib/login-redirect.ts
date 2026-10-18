/**
 * The login page, asked to return somewhere once signed in (its ?from=,
 * which login validates again with safeReturnPath before using it).
 */
import { DEFAULT_RETURN_PATH, safeReturnPath } from "@/lib/safe-return-path";

/** Sign-in pages: returning to one after signing in would loop. */
const SIGN_IN_PATHS = ["/login", "/register", "/signup"];

/**
 * /login returning to `path` (pathname + search). Any fragment is dropped
 * first, whoever the caller: it can hold a credential (an invitation token)
 * and must never be put into another URL. An unsafe path returns to the
 * dashboard instead; a sign-in page gets plain /login.
 */
export function loginPathReturningTo(path: string): string {
  const withoutFragment = path.split("#", 1)[0];
  const returnTo = safeReturnPath(withoutFragment) ?? DEFAULT_RETURN_PATH;
  const pathname = returnTo.split(/[?#]/, 1)[0];
  if (SIGN_IN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return "/login";
  }
  return `/login?from=${encodeURIComponent(returnTo)}`;
}

/** loginPathReturningTo for the page this tab is on now. */
export function loginPathReturningHere(): string {
  return loginPathReturningTo(window.location.pathname + window.location.search);
}
