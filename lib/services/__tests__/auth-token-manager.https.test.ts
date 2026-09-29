// @vitest-environment-options {"url": "https://app.devcontrol.test/"}
/**
 * tokenManager's auth cookie when the app is served over https.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { tokenManager } from "@/lib/services/auth.service";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzZWNyZXQiOiJ0b2tlbiJ9.c2lnbmF0dXJl";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tokenManager auth cookie over https", () => {
  it("runs on an https origin", () => {
    expect(window.location.protocol).toBe("https:");
  });

  it("sets auth-token with Secure, path and SameSite=Strict", () => {
    const writes = vi.spyOn(document, "cookie", "set");

    tokenManager.setAuthCookie(TOKEN);

    const cookie = writes.mock.calls[0][0] as string;
    expect(cookie.startsWith(`auth-token=${TOKEN};`)).toBe(true);
    expect(cookie).toMatch(/;\s*Secure(;|$)/);
    expect(cookie).toContain("path=/");
    expect(cookie).toContain("SameSite=Strict");
    expect(document.cookie).toContain(`auth-token=${TOKEN}`);
  });

  it("clears auth-token with the same Secure, path and SameSite attributes", () => {
    tokenManager.setAuthCookie(TOKEN);
    const writes = vi.spyOn(document, "cookie", "set");

    tokenManager.clearAuthCookie();

    const cookie = writes.mock.calls[0][0] as string;
    expect(cookie).toContain("max-age=0");
    expect(cookie).toMatch(/;\s*Secure(;|$)/);
    expect(cookie).toContain("path=/");
    expect(cookie).toContain("SameSite=Strict");
    expect(document.cookie).not.toContain("auth-token=");
  });
});
