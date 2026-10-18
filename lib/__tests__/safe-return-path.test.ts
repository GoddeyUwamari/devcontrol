/**
 * safeReturnPath: only a path on this site is accepted as a post-login
 * destination; every open-redirect shape is rejected, and what is returned
 * is the resolved path, not the raw input.
 */
import { describe, it, expect } from "vitest";
import { safeReturnPath } from "../safe-return-path";
import { DOT_SEGMENT_ESCAPES } from "./support/open-redirect-cases";

describe("safeReturnPath", () => {
  it.each([
    "/dashboard",
    "/accept-invitation",
    "/settings/sso",
    "/services?tab=health",
    "/services#health",
    "/",
    "/a%20b",
  ])("accepts the same-origin path %j", (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([
    // Not a string / empty / too long
    [undefined],
    [null],
    [42],
    [""],
    ["/" + "a".repeat(2048)],
    // Not starting with "/"
    ["dashboard"],
    ["./dashboard"],
    [" /dashboard"],
    // Any scheme
    ["https://evil.example"],
    ["http://evil.example/dashboard"],
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["data:text/html,hi"],
    ["mailto:someone@example.test"],
    // Protocol-relative
    ["//evil.example"],
    ["//evil.example/dashboard"],
    ["///evil.example"],
    // Backslash (browsers treat it as "/")
    ["/\\evil.example"],
    ["\\\\evil.example"],
    ["/dashboard\\..\\x"],
    // Control characters (tab/newline are dropped by URL parsing)
    ["/\t/evil.example"],
    ["/\n/evil.example"],
    ["/\r/evil.example"],
    ["/dash\u0000board"],
    ["/dash\u007fboard"],
    // Encoded variants
    ["/%2F%2Fevil.example"],
    ["/%2fevil.example"],
    ["%2F%2Fevil.example"],
    ["/%5Cevil.example"],
    ["/%5cevil.example"],
    ["/%09/evil.example"],
    ["/%0A/evil.example"],
    ["/%00"],
    ["%68ttps://evil.example"],
    // Double-encoded
    ["/%252F%252Fevil.example"],
    ["/%255Cevil.example"],
    // Deeply nested encoding
    ["/%25252525252F%25252525252Fevil.example"],
    // Malformed encoding
    ["/%E0%A4%A"],
  ])("rejects %j", (value) => {
    expect(safeReturnPath(value)).toBeNull();
  });

  it.each(DOT_SEGMENT_ESCAPES)("rejects %j, which resolves to a protocol-relative path", (value) => {
    expect(safeReturnPath(value)).toBeNull();
  });

  it.each([
    ["/a/../dashboard", "/dashboard"],
    ["/./accept-invitation", "/accept-invitation"],
    ["/settings/./sso/", "/settings/sso/"],
    ["/..", "/"],
    ["/../dashboard?tab=1#x", "/dashboard?tab=1#x"],
  ])("returns %j resolved, as %j", (value, resolved) => {
    expect(safeReturnPath(value)).toBe(resolved);
  });
});
