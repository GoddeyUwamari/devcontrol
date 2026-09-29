/**
 * authService.refreshToken request contract and tokenManager's auth cookie,
 * over plain http (the default jsdom origin). The https behavior is covered in
 * auth-token-manager.https.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "@/lib/api";
import { authService, tokenManager } from "@/lib/services/auth.service";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzZWNyZXQiOiJ0b2tlbiJ9.c2lnbmF0dXJl";

function cookieWrites() {
  return vi.spyOn(document, "cookie", "set");
}

function consoleSpies() {
  return (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {})
  );
}

function loggedText(spies: ReturnType<typeof consoleSpies>): string {
  return spies.flatMap((s) => s.mock.calls.flat()).map(String).join("\n");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authService.refreshToken", () => {
  it("posts { refreshToken } to /api/auth/refresh and returns the response body", async () => {
    const body = { success: true, data: { accessToken: "new-access", refreshToken: "new-refresh" } };
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: body });

    await expect(authService.refreshToken("old-refresh")).resolves.toEqual(body);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/api/auth/refresh", { refreshToken: "old-refresh" });
  });
});

describe("tokenManager auth cookie over http", () => {
  it("sets auth-token with path, SameSite=Strict and max-age, without Secure", () => {
    const writes = cookieWrites();

    tokenManager.setAuthCookie(TOKEN);

    expect(writes).toHaveBeenCalledTimes(1);
    const cookie = writes.mock.calls[0][0] as string;
    expect(cookie.startsWith(`auth-token=${TOKEN};`)).toBe(true);
    expect(cookie).toContain("path=/");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain(`max-age=${30 * 24 * 60 * 60}`);
    expect(cookie).not.toMatch(/secure/i);
    expect(document.cookie).toContain(`auth-token=${TOKEN}`);
  });

  it("clears auth-token with the same path and SameSite attributes", () => {
    tokenManager.setAuthCookie(TOKEN);
    const writes = cookieWrites();

    tokenManager.clearAuthCookie();

    const cookie = writes.mock.calls[0][0] as string;
    expect(cookie.startsWith("auth-token=;")).toBe(true);
    expect(cookie).toContain("max-age=0");
    expect(cookie).toContain("path=/");
    expect(cookie).toContain("SameSite=Strict");
    expect(document.cookie).not.toContain("auth-token=");
  });

  it("never logs the token value", () => {
    const spies = consoleSpies();

    tokenManager.setAuthCookie(TOKEN);
    tokenManager.clearAuthCookie();

    expect(loggedText(spies)).not.toContain(TOKEN.slice(0, 20));
  });
});
