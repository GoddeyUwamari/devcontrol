/**
 * SSO callback: the backend hands over the tokens in the URL fragment. The
 * page removes them from the URL before it stores them or calls /me, stores
 * them where the rest of the app reads them (tokenManager), sets the auth
 * cookie the same way as password login, and no longer writes the obsolete
 * localStorage keys. Links in the legacy query-string form still work and are
 * cleaned the same way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import SSOCallbackPage from "../page";
import { tokenManager } from "@/lib/services/auth.service";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

const ACCESS = "sso-access-token";
const REFRESH = "sso-refresh-token";
const USER = { id: "user-1", email: "u1@example.test", fullName: "User One" };

let fetchMock: ReturnType<typeof vi.fn>;

function visit(path: string) {
  window.history.replaceState(null, "", path);
}

function fragmentLink(params: Record<string, string>) {
  return `/auth/sso/callback#${new URLSearchParams(params).toString()}`;
}

function expectNoTokensInUrl() {
  expect(window.location.href).not.toContain(ACCESS);
  expect(window.location.href).not.toContain(REFRESH);
}

beforeEach(() => {
  localStorage.clear();
  replace.mockReset();
  fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ success: true, data: USER }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  visit("/");
});

describe("SSO callback", () => {
  it("stores the access and refresh tokens through tokenManager and sets the auth cookie", async () => {
    visit(fragmentLink({ token: ACCESS, refreshToken: REFRESH, orgId: "org-1" }));
    const setCookie = vi.spyOn(tokenManager, "setAuthCookie");

    render(<SSOCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(tokenManager.getAccessToken()).toBe(ACCESS);
    expect(tokenManager.getRefreshToken()).toBe(REFRESH);
    expect(setCookie).toHaveBeenCalledWith(ACCESS);
    expect(document.cookie).toContain(`auth-token=${ACCESS}`);
  });

  it("removes the fragment from the URL, keeping the callback path", async () => {
    visit(fragmentLink({ token: ACCESS, refreshToken: REFRESH, orgId: "org-1" }));

    render(<SSOCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(window.location.pathname).toBe("/auth/sso/callback");
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
    expectNoTokensInUrl();
  });

  it("the URL is already clean when the tokens are stored and when /me is called", async () => {
    visit(fragmentLink({ token: ACCESS, refreshToken: REFRESH, orgId: "org-1" }));
    const hrefWhenStored: string[] = [];
    vi.spyOn(tokenManager, "setAccessToken").mockImplementation(function (this: unknown, t: string) {
      hrefWhenStored.push(window.location.href);
      localStorage.setItem("accessToken", t);
    });
    const hrefWhenMeCalled: string[] = [];
    fetchMock.mockImplementation(async () => {
      hrefWhenMeCalled.push(window.location.href);
      return { json: async () => ({ success: true, data: USER }) };
    });

    render(<SSOCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(hrefWhenStored).toHaveLength(1);
    expect(hrefWhenMeCalled).toHaveLength(1);
    for (const href of [...hrefWhenStored, ...hrefWhenMeCalled]) {
      expect(href).not.toContain(ACCESS);
      expect(href).not.toContain(REFRESH);
      expect(new URL(href).hash).toBe("");
    }
  });

  it("accepts the legacy query-string form and removes it before calling /me", async () => {
    visit(`/auth/sso/callback?${new URLSearchParams({ token: ACCESS, refreshToken: REFRESH, orgId: "org-1" })}`);
    const hrefWhenMeCalled: string[] = [];
    fetchMock.mockImplementation(async () => {
      hrefWhenMeCalled.push(window.location.href);
      return { json: async () => ({ success: true, data: USER }) };
    });

    render(<SSOCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(tokenManager.getAccessToken()).toBe(ACCESS);
    expect(tokenManager.getRefreshToken()).toBe(REFRESH);
    expect(hrefWhenMeCalled[0]).not.toContain(ACCESS);
    expect(window.location.search).toBe("");
    expectNoTokensInUrl();
  });

  it("no longer writes the obsolete auth-token, refresh-token or organization-id keys", async () => {
    visit(fragmentLink({ token: ACCESS, refreshToken: REFRESH, orgId: "org-1" }));

    render(<SSOCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(localStorage.getItem("auth-token")).toBeNull();
    expect(localStorage.getItem("refresh-token")).toBeNull();
    expect(localStorage.getItem("organization-id")).toBeNull();
  });

  it("still fetches /me with the SSO access token and stores the user", async () => {
    visit(fragmentLink({ token: ACCESS, refreshToken: REFRESH }));

    render(<SSOCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/auth\/me$/);
    expect(init.headers.Authorization).toBe(`Bearer ${ACCESS}`);
    expect(JSON.parse(localStorage.getItem("user") ?? "null")).toEqual(USER);
  });

  it("still navigates to /dashboard when /me fails", async () => {
    visit(fragmentLink({ token: ACCESS, refreshToken: REFRESH }));
    fetchMock.mockRejectedValue(new Error("network"));

    render(<SSOCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(tokenManager.getAccessToken()).toBe(ACCESS);
  });

  it.each([
    ["no tokens", {}],
    ["no refresh token", { token: ACCESS }],
    ["no access token", { refreshToken: REFRESH }],
  ])("%s: shows the error, stores nothing, does not navigate, and leaves no token in the URL", async (_label, params) => {
    visit(fragmentLink(params as Record<string, string>));

    render(<SSOCallbackPage />);

    expect(await screen.findByText(/missing tokens/i)).toBeInTheDocument();
    expect(tokenManager.getAccessToken()).toBeNull();
    expect(tokenManager.getRefreshToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expectNoTokensInUrl();
  });
});
