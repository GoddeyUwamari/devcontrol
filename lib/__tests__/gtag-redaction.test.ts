/**
 * gaPageLocation: the URL Google Analytics may see. Never the fragment; no
 * query string on paths that can carry a credential or identifier; elsewhere
 * only utm_* and gclid. urlCarriesCredentials: what the GA opt-out guard
 * treats as a credential in the URL. Placeholder values only.
 */
import { describe, it, expect } from "vitest";
import { gaPageLocation, urlCarriesCredentials } from "@/lib/gtag";

const ORIGIN = "https://app.example.test";
const SECRET = "PLACEHOLDER-secret-value-0123456789";

describe("gaPageLocation", () => {
  it.each([
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/accept-invitation",
    "/auth/sso/callback",
    "/billing/success",
  ])("%s keeps origin and path only", (path) => {
    for (const suffix of [
      `?token=${SECRET}`,
      `?utm_source=mail&token=${SECRET}`,
      `#token=${SECRET}`,
      `?email=a%40example.test&password=${SECRET}#refreshToken=${SECRET}`,
      `?session_id=cs_test_${SECRET}`,
      `?from=%2Faccept-invitation%3Ftoken%3D${SECRET}`,
    ]) {
      expect(gaPageLocation(`${ORIGIN}${path}${suffix}`)).toBe(`${ORIGIN}${path}`);
    }
  });

  it.each([
    ["/login/", "/login/"],
    ["/LOGIN", "/LOGIN"],
    ["/reset-password/extra", "/reset-password/extra"],
    ["/auth/sso/callback/", "/auth/sso/callback/"],
  ])("%s (trailing slash, case, sub-path) is still treated as sensitive", (path, expected) => {
    expect(gaPageLocation(`${ORIGIN}${path}?token=${SECRET}&utm_source=x`)).toBe(`${ORIGIN}${expected}`);
  });

  it("a path that only starts with the same letters is not sensitive", () => {
    expect(gaPageLocation(`${ORIGIN}/login-help?utm_source=x`)).toBe(`${ORIGIN}/login-help?utm_source=x`);
  });

  it("elsewhere keeps utm_* and gclid only, in their order", () => {
    expect(
      gaPageLocation(
        `${ORIGIN}/pricing?token=${SECRET}&utm_source=news&plan=pro&utm_campaign=q4&gclid=abc&code=${SECRET}`
      )
    ).toBe(`${ORIGIN}/pricing?utm_source=news&utm_campaign=q4&gclid=abc`);
  });

  it("drops any query that has no kept param, and the trailing ?", () => {
    expect(gaPageLocation(`${ORIGIN}/dashboard?tab=costs&session_id=${SECRET}`)).toBe(`${ORIGIN}/dashboard`);
    expect(gaPageLocation(`${ORIGIN}/?`)).toBe(`${ORIGIN}/`);
  });

  it("always drops the fragment", () => {
    expect(gaPageLocation(`${ORIGIN}/pricing?utm_source=x#token=${SECRET}`)).toBe(`${ORIGIN}/pricing?utm_source=x`);
    expect(gaPageLocation(`${ORIGIN}/docs#section-2`)).toBe(`${ORIGIN}/docs`);
  });

  it("drops credentials in an external referrer the same way", () => {
    expect(gaPageLocation(`https://mail.example.test/read?msg=${SECRET}#token=${SECRET}`)).toBe(
      "https://mail.example.test/read"
    );
  });

  it("gives '' for an empty or unparseable value (no document.referrer)", () => {
    expect(gaPageLocation("")).toBe("");
    expect(gaPageLocation("not a url")).toBe("");
  });
});

describe("urlCarriesCredentials", () => {
  it.each([
    `?token=${SECRET}`,
    `#token=${SECRET}`,
    `#refreshToken=${SECRET}`,
    `?password=${SECRET}`,
    `?confirmPassword=${SECRET}`,
    `?access_token=${SECRET}`,
    `#id_token=${SECRET}`,
    `?code=${SECRET}`,
    `?TOKEN=${SECRET}`,
  ])("is true for %s", (suffix) => {
    expect(urlCarriesCredentials(`${ORIGIN}/any${suffix}`)).toBe(true);
  });

  it.each(["", "?utm_source=x", "?session_id=cs_test_1", "?from=%2Fdashboard", "#section-2", "?error=sso_failed"])(
    "is false for %j",
    (suffix) => {
      expect(urlCarriesCredentials(`${ORIGIN}/any${suffix}`)).toBe(false);
    }
  );
});
