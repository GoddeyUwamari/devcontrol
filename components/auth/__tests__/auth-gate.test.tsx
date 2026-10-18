/**
 * AuthGate, the app routes' only guard, with the real AuthProvider: a visitor
 * who arrives signed out is replaced to /login?from=<this page>; a signed-in
 * user only ever sees the loader, then the app; and a session that ends while
 * the app is open gets exactly one navigation, from the auth context --
 * /login for a logout, /login?from= for an expiry.
 *
 * The auth service calls and navigation are faked. Placeholder values only.
 */
import { StrictMode, useEffect } from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/contexts/auth-context";
import { authService } from "@/lib/services/auth.service";
import { organizationsService } from "@/lib/services/organizations.service";
import { savePendingInvitation } from "@/lib/pending-invitation";
import { AuthGate } from "../auth-gate";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const USER = { id: "user-1", email: "user@example.test", fullName: "User One" };
const SESSION = { accessToken: "access-placeholder", refreshToken: "refresh-placeholder", user: USER };

let auth: ReturnType<typeof useAuth>;
/** isAuthenticated as seen by every render of the gated app. */
let appRenders: boolean[];

/** Stands in for the app shell: records each render, exposes the auth context. */
function App() {
  const value = useAuth();
  appRenders.push(value.isAuthenticated);
  useEffect(() => {
    auth = value;
  });
  return <p>signed-in app</p>;
}

/** Outside the gate, so a test can reach the context when the app is not rendered. */
function Probe() {
  const value = useAuth();
  useEffect(() => {
    auth = value;
  });
  return null;
}

function tree() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
        <AuthGate>
          <App />
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  );
}

async function mount({ strict = false } = {}) {
  render(strict ? <StrictMode>{tree()}</StrictMode> : tree());
  await act(async () => {});
}

function signedInFromCache() {
  localStorage.setItem("accessToken", SESSION.accessToken);
  localStorage.setItem("user", JSON.stringify(USER));
}

function expectLoader() {
  const status = screen.getByRole("status");
  expect(status).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByText("signed-in app")).toBeNull();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  appRenders = [];
  push.mockReset().mockResolvedValue(undefined);
  replace.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(organizationsService, "getAll").mockResolvedValue([] as never);
  vi.spyOn(authService, "getCurrentUser").mockResolvedValue(USER as never);
  vi.spyOn(authService, "logout").mockResolvedValue(undefined as never);
  window.history.replaceState(null, "", "/dashboard");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("arriving signed out", () => {
  it("replaces to /login?from=<this page>, once, and never renders the app", async () => {
    await mount();

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/login?from=%2Fdashboard");
    expect(push).not.toHaveBeenCalled();
    expect(appRenders).toEqual([]);
    expectLoader();
  });

  it("keeps the query string", async () => {
    window.history.replaceState(null, "", "/costs?range=30d");
    await mount();
    expect(replace).toHaveBeenCalledWith("/login?from=%2Fcosts%3Frange%3D30d");
  });

  it("never carries the fragment into the URL", async () => {
    window.history.replaceState(null, "", "/settings/sso#token=placeholder-fragment");
    await mount();
    expect(replace).toHaveBeenCalledWith("/login?from=%2Fsettings%2Fsso");
  });

  it("navigates once under Strict Mode", async () => {
    await mount({ strict: true });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("signed in", () => {
  it("the server-rendered HTML is the loader, not the app", () => {
    signedInFromCache();
    const html = renderToString(tree());
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("signed-in app");
  });

  it("renders the app with no navigation, and never signed out", async () => {
    signedInFromCache();
    await mount();

    expect(screen.getByText("signed-in app")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(appRenders.length).toBeGreaterThan(0);
    expect(appRenders.every(Boolean)).toBe(true);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("logout", () => {
  it("goes to /login with no ?from=, in one navigation; the app is replaced by the loader", async () => {
    signedInFromCache();
    await mount();

    await act(() => auth.logout());

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/login");
    expect(replace).not.toHaveBeenCalled();
    expect(appRenders.every(Boolean)).toBe(true);
    expectLoader();
  });
});

describe("session expiry (refreshUser 401, no refresh token)", () => {
  beforeEach(() => {
    signedInFromCache();
    vi.spyOn(authService, "getCurrentUser").mockRejectedValue({ response: { status: 401 } });
  });

  it("goes to /login?from=<this page>, in one navigation", async () => {
    window.history.replaceState(null, "", "/costs?range=30d");
    await mount();

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/login?from=%2Fcosts%3Frange%3D30d");
    expect(replace).not.toHaveBeenCalled();
    expect(appRenders.every(Boolean)).toBe(true);
    expectLoader();
  });

  it("with a pending invitation, goes to plain /login, and signing in returns to the invitation", async () => {
    savePendingInvitation("pending-invite-placeholder");
    await mount();

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/login");
    expect(replace).not.toHaveBeenCalled();

    push.mockClear();
    vi.spyOn(authService, "login").mockResolvedValue({ data: SESSION } as never);
    vi.spyOn(authService, "getCurrentUser").mockResolvedValue(USER as never);
    // login() arms a 100 ms hard-navigation fallback; run it here (a no-op:
    // this tab is not on /login) rather than leak it past the test.
    vi.useFakeTimers();
    await act(() => auth.login(USER.email, "placeholder-password"));
    expect(push).toHaveBeenCalledWith("/accept-invitation");
    vi.runOnlyPendingTimers();
    expect(vi.getTimerCount()).toBe(0);
  });
});
