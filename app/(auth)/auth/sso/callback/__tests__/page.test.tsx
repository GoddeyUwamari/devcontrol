/**
 * SSO callback: tokens from the redirect are stored where the rest of the app
 * reads them (tokenManager), the auth cookie is set the same way as for
 * password login, and the obsolete localStorage keys are no longer written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import SSOCallbackPage from "../page";
import { tokenManager } from "@/lib/services/auth.service";

const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

const ACCESS = "sso-access-token";
const REFRESH = "sso-refresh-token";
const USER = { id: "user-1", email: "u1@example.test", fullName: "User One" };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  replace.mockReset();
  fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ success: true, data: USER }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SSO callback", () => {
  it("stores the access and refresh tokens through tokenManager and sets the auth cookie", async () => {
    searchParams = new URLSearchParams({ token: ACCESS, refreshToken: REFRESH, orgId: "org-1" });
    const setCookie = vi.spyOn(tokenManager, "setAuthCookie");

    render(<SSOCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(tokenManager.getAccessToken()).toBe(ACCESS);
    expect(tokenManager.getRefreshToken()).toBe(REFRESH);
    expect(setCookie).toHaveBeenCalledWith(ACCESS);
    expect(document.cookie).toContain(`auth-token=${ACCESS}`);
  });

  it("no longer writes the obsolete auth-token, refresh-token or organization-id keys", async () => {
    searchParams = new URLSearchParams({ token: ACCESS, refreshToken: REFRESH, orgId: "org-1" });

    render(<SSOCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(localStorage.getItem("auth-token")).toBeNull();
    expect(localStorage.getItem("refresh-token")).toBeNull();
    expect(localStorage.getItem("organization-id")).toBeNull();
  });

  it("still fetches /me with the SSO access token and stores the user", async () => {
    searchParams = new URLSearchParams({ token: ACCESS, refreshToken: REFRESH });

    render(<SSOCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/auth\/me$/);
    expect(init.headers.Authorization).toBe(`Bearer ${ACCESS}`);
    expect(JSON.parse(localStorage.getItem("user") ?? "null")).toEqual(USER);
  });

  it("still navigates to /dashboard when /me fails", async () => {
    searchParams = new URLSearchParams({ token: ACCESS, refreshToken: REFRESH });
    fetchMock.mockRejectedValue(new Error("network"));

    render(<SSOCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(tokenManager.getAccessToken()).toBe(ACCESS);
  });

  it.each([
    ["no tokens", {}],
    ["no refresh token", { token: ACCESS }],
    ["no access token", { refreshToken: REFRESH }],
  ])("%s: shows the error, stores nothing, and does not navigate", async (_label, params) => {
    searchParams = new URLSearchParams(params as Record<string, string>);

    render(<SSOCallbackPage />);

    expect(await screen.findByText(/missing tokens/i)).toBeInTheDocument();
    expect(tokenManager.getAccessToken()).toBeNull();
    expect(tokenManager.getRefreshToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
