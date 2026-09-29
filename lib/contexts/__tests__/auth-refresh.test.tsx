/**
 * AuthProvider.refreshUser -- recovering an expired access token.
 *
 * Runs the real AuthProvider; only the auth API calls and navigation are
 * faked. Refresh tokens are single-use on the backend, so a second tab that
 * refreshes with the same token is rejected; these tests cover that the
 * rejected tab adopts the session the other tab stored instead of logging out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth, REFRESH_RACE_RECHECK_MS } from "@/lib/contexts/auth-context";
import { authService, tokenManager } from "@/lib/services/auth.service";
import { api } from "@/lib/api";
import { organizationsService } from "@/lib/services/organizations.service";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

const USER = { id: "user-1", email: "u1@example.test", fullName: "User One" };
const ORG = { id: "org-1", name: "Org One", slug: "org-one" };
const ME = { ...USER, organizations: [ORG] };
const unauthorized = () => Object.assign(new Error("expired"), { response: { status: 401 } });

let auth: ReturnType<typeof useAuth>;
function Capture() {
  const value = useAuth();
  useEffect(() => { auth = value; });
  return null;
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Capture />
      </AuthProvider>
    </QueryClientProvider>
  );
  await act(async () => {});
}

/** Tokens this tab holds. No cached user, so mount doesn't trigger refreshUser itself. */
function seedTokens(access = "access-old", refresh = "refresh-old") {
  localStorage.setItem("accessToken", access);
  localStorage.setItem("refreshToken", refresh);
}

/** What another tab writes after successfully rotating the shared refresh token. */
function otherTabRotates() {
  localStorage.setItem("accessToken", "access-other-tab");
  localStorage.setItem("refreshToken", "refresh-other-tab");
}

/** /me answers only for the given access token(s), like the backend. */
function meAcceptsOnly(...tokens: string[]) {
  return vi.spyOn(authService, "getCurrentUser").mockImplementation(async () => {
    if (tokens.includes(localStorage.getItem("accessToken") ?? "")) return ME as never;
    throw unauthorized();
  });
}

function expectLoggedOut() {
  expect(localStorage.getItem("accessToken")).toBeNull();
  expect(localStorage.getItem("refreshToken")).toBeNull();
  expect(push).toHaveBeenCalledWith("/login");
}

function expectSignedInAs(accessToken: string, refreshToken: string) {
  expect(localStorage.getItem("accessToken")).toBe(accessToken);
  expect(localStorage.getItem("refreshToken")).toBe(refreshToken);
  expect(push).not.toHaveBeenCalled();
  expect(auth.user).toMatchObject({ id: USER.id });
  expect(auth.organization).toMatchObject({ id: ORG.id });
}

beforeEach(() => {
  localStorage.clear();
  push.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Network double for the organization list the provider loads alongside /me.
  vi.spyOn(organizationsService, "getAll").mockResolvedValue([ORG] as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("refreshUser after /me returns 401", () => {
  it("refreshes with the stored refresh token, persists both new tokens, and retries /me", async () => {
    seedTokens();
    const me = meAcceptsOnly("access-new");
    const refresh = vi.spyOn(authService, "refreshToken").mockResolvedValue({
      success: true,
      data: { accessToken: "access-new", refreshToken: "refresh-new" },
    });
    const cookie = vi.spyOn(tokenManager, "setAuthCookie");
    await mount();

    await act(async () => { await auth.refreshUser(); });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("refresh-old");
    expect(me).toHaveBeenCalledTimes(2);
    expect(cookie).toHaveBeenCalledWith("access-new");
    expectSignedInAs("access-new", "refresh-new");
  });

  it("the refresh request goes to /api/auth/refresh with { refreshToken }", async () => {
    seedTokens();
    meAcceptsOnly("access-new");
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: { success: true, data: { accessToken: "access-new", refreshToken: "refresh-new" } },
    });
    await mount();

    await act(async () => { await auth.refreshUser(); });

    expect(post).toHaveBeenCalledWith("/api/auth/refresh", { refreshToken: "refresh-old" });
    expectSignedInAs("access-new", "refresh-new");
  });

  it("a rejected refresh with no other session clears the session and redirects to /login", async () => {
    seedTokens();
    meAcceptsOnly();
    vi.spyOn(authService, "refreshToken").mockRejectedValue(unauthorized());
    const clearCookie = vi.spyOn(tokenManager, "clearAuthCookie");
    await mount();

    await act(async () => { await auth.refreshUser(); });

    expectLoggedOut();
    expect(clearCookie).toHaveBeenCalled();
    expect(auth.user).toBeNull();
  });

  it("waits at most once, briefly, before logging out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    seedTokens();
    meAcceptsOnly();
    vi.spyOn(authService, "refreshToken").mockRejectedValue(unauthorized());
    await mount();

    let settled = false;
    let pending!: Promise<void>;
    await act(async () => {
      pending = auth.refreshUser().then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(REFRESH_RACE_RECHECK_MS - 1);
    });
    expect(settled).toBe(false);
    expect(push).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await pending;
    });
    expect(settled).toBe(true);
    expectLoggedOut();
  });

  it("no refresh token: clears the session and redirects without calling refresh", async () => {
    localStorage.setItem("accessToken", "access-old");
    meAcceptsOnly();
    const refresh = vi.spyOn(authService, "refreshToken");
    await mount();

    await act(async () => { await auth.refreshUser(); });

    expect(refresh).not.toHaveBeenCalled();
    expectLoggedOut();
  });
});

describe("refresh race with another tab (single-use refresh tokens)", () => {
  it("another tab rotated before this refresh was rejected: adopts its session without logging out", async () => {
    seedTokens();
    const me = meAcceptsOnly("access-other-tab");
    const refresh = vi.spyOn(authService, "refreshToken").mockImplementation(async () => {
      otherTabRotates(); // the other tab won; this tab's copy of the token is now spent
      throw unauthorized();
    });
    await mount();

    await act(async () => { await auth.refreshUser(); });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(me).toHaveBeenCalledTimes(2);
    expectSignedInAs("access-other-tab", "refresh-other-tab");
  });

  it("another tab finishes rotating during the wait: adopts its session without logging out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    seedTokens();
    meAcceptsOnly("access-other-tab");
    vi.spyOn(authService, "refreshToken").mockRejectedValue(unauthorized());
    await mount();

    let pending!: Promise<void>;
    await act(async () => {
      pending = auth.refreshUser();
      await vi.advanceTimersByTimeAsync(REFRESH_RACE_RECHECK_MS / 2);
      otherTabRotates();
      await vi.advanceTimersByTimeAsync(REFRESH_RACE_RECHECK_MS);
      await pending;
    });

    expectSignedInAs("access-other-tab", "refresh-other-tab");
  });

  it("another tab's session is also rejected by /me: logs out", async () => {
    seedTokens();
    meAcceptsOnly();
    vi.spyOn(authService, "refreshToken").mockImplementation(async () => {
      otherTabRotates();
      throw unauthorized();
    });
    await mount();

    await act(async () => { await auth.refreshUser(); });

    expectLoggedOut();
  });

  it("another tab logged out (tokens cleared): logs out", async () => {
    seedTokens();
    meAcceptsOnly();
    vi.spyOn(authService, "refreshToken").mockImplementation(async () => {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      throw unauthorized();
    });
    await mount();

    await act(async () => { await auth.refreshUser(); });

    expect(push).toHaveBeenCalledWith("/login");
  });
});

describe("non-401 errors are unchanged", () => {
  it.each([500, 503, undefined])("status %s: keeps the session, does not refresh or redirect", async (status) => {
    seedTokens();
    localStorage.setItem("user", JSON.stringify(USER));
    const refresh = vi.spyOn(authService, "refreshToken");
    vi.spyOn(authService, "getCurrentUser").mockRejectedValue(
      Object.assign(new Error("boom"), status ? { response: { status } } : {})
    );
    await mount();

    await act(async () => { await auth.refreshUser(); });

    expect(refresh).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(localStorage.getItem("accessToken")).toBe("access-old");
    expect(localStorage.getItem("refreshToken")).toBe("refresh-old");
  });
});

describe("token values are not logged during refresh", () => {
  it("no console output contains the old or new tokens", async () => {
    seedTokens();
    meAcceptsOnly("access-new");
    vi.spyOn(authService, "refreshToken").mockResolvedValue({
      success: true,
      data: { accessToken: "access-new", refreshToken: "refresh-new" },
    });
    await mount();

    await act(async () => { await auth.refreshUser(); });

    const logged = [console.log, console.warn, console.error]
      .flatMap((fn) => vi.mocked(fn).mock.calls.flat())
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");
    for (const token of ["access-old", "refresh-old", "access-new", "refresh-new"]) {
      expect(logged).not.toContain(token);
    }
  });
});

describe("token values are not logged during login", () => {
  it("no console output contains the issued tokens", async () => {
    // login() schedules a hard-navigation fallback; keep it from running.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.spyOn(authService, "login").mockResolvedValue({
      success: true,
      data: { accessToken: "login-access", refreshToken: "login-refresh", user: USER, organization: ORG },
    } as never);
    await mount();

    await act(async () => { await auth.login(USER.email, "pw"); });

    expect(localStorage.getItem("accessToken")).toBe("login-access");
    const logged = [console.log, console.warn, console.error]
      .flatMap((fn) => vi.mocked(fn).mock.calls.flat())
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");
    expect(logged).not.toContain("login-access");
    expect(logged).not.toContain("login-refresh");
  });
});

describe("no global 401 handling in the API client", () => {
  it("the axios response interceptor passes 401s through untouched", async () => {
    const handlers = ((api.interceptors.response as any).handlers ?? []).filter(Boolean);
    expect(handlers).toHaveLength(1);

    seedTokens();
    const error = unauthorized();
    await expect(handlers[0].rejected(error)).rejects.toBe(error);
    expect(localStorage.getItem("accessToken")).toBe("access-old");
    expect(localStorage.getItem("refreshToken")).toBe("refresh-old");
  });
});
