/**
 * loginPathReturningTo: the /login?from= that AuthGate and session expiry
 * send to. The return path is the page's own path and query, re-validated
 * by login with safeReturnPath, so it round-trips exactly; a fragment is
 * never carried (it can hold a token); an unsafe path
 * returns to the dashboard, and a sign-in page gets no return path.
 */
import { describe, it, expect } from "vitest";
import { loginPathReturningTo } from "../login-redirect";
import { safeReturnPath } from "../safe-return-path";
import { DOT_SEGMENT_ESCAPES } from "./support/open-redirect-cases";

function from(loginPath: string): string | null {
  return new URL(loginPath, "https://placeholder.invalid").searchParams.get("from");
}

describe("loginPathReturningTo", () => {
  it.each([
    ["/dashboard", "/login?from=%2Fdashboard"],
    ["/costs?range=30d", "/login?from=%2Fcosts%3Frange%3D30d"],
    ["/settings/organization", "/login?from=%2Fsettings%2Forganization"],
    ["/", "/login?from=%2F"],
  ])("%j → %j", (path, expected) => {
    expect(loginPathReturningTo(path)).toBe(expected);
  });

  it.each(["/dashboard", "/costs?range=30d", "/services?tab=health&q=a%20b", "/accept-invitation"])(
    "%j round-trips through ?from= and safeReturnPath",
    (path) => {
      expect(safeReturnPath(from(loginPathReturningTo(path)))).toBe(path);
    }
  );

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", ...DOT_SEGMENT_ESCAPES])(
    "returns to the dashboard for the unsafe %j",
    (path) => {
      expect(loginPathReturningTo(path)).toBe("/login?from=%2Fdashboard");
    }
  );

  it.each(["/login", "/login?error=sso_failed", "/register", "/register?from=%2Fdashboard", "/signup"])(
    "gives the sign-in page %j no return path",
    (path) => {
      expect(loginPathReturningTo(path)).toBe("/login");
    }
  );

  it.each([
    ["/dashboard#t", "/login?from=%2Fdashboard"],
    ["/costs?range=30d#token=placeholder", "/login?from=%2Fcosts%3Frange%3D30d"],
    ["/accept-invitation#token=placeholder", "/login?from=%2Faccept-invitation"],
    ["/login#token=placeholder", "/login"],
  ])("drops the fragment of %j", (path, expected) => {
    expect(loginPathReturningTo(path)).toBe(expected);
  });

  it("does not treat a lookalike path as a sign-in page", () => {
    expect(loginPathReturningTo("/login-history")).toBe("/login?from=%2Flogin-history");
  });
});
