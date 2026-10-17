/**
 * login() and register() go to a caller's return path once signed in, but
 * only a same-origin path (safeReturnPath); anything else falls back to
 * /dashboard -- or /accept-invitation when an invitation is pending in this
 * tab. logout() forgets a pending invitation; session expiry deliberately
 * does not (see the test below).
 *
 * Runs the real AuthProvider; the auth service calls and navigation are faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/contexts/auth-context";
import { authService } from "@/lib/services/auth.service";
import { organizationsService } from "@/lib/services/organizations.service";
import { PENDING_INVITATION_KEY, savePendingInvitation } from "@/lib/pending-invitation";
import { DOT_SEGMENT_ESCAPES } from "@/lib/__tests__/support/open-redirect-cases";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));

const USER = { id: "user-1", email: "user@example.test", fullName: "User One" };
const SESSION = { accessToken: "access-placeholder", refreshToken: "refresh-placeholder", user: USER };

let auth: ReturnType<typeof useAuth>;

function Probe({ onAuth }: { onAuth: (value: ReturnType<typeof useAuth>) => void }) {
  onAuth(useAuth());
  return null;
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe onAuth={(value) => (auth = value)} />
      </AuthProvider>
    </QueryClientProvider>
  );
  await act(async () => {});
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  push.mockReset();
  push.mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(organizationsService, "getAll").mockResolvedValue([] as never);
  vi.spyOn(authService, "login").mockResolvedValue({ data: SESSION } as never);
  vi.spyOn(authService, "register").mockResolvedValue({ data: SESSION } as never);
  vi.spyOn(authService, "logout").mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

const UNSAFE = [
  "https://evil.example",
  "//evil.example",
  "/\\evil.example",
  "javascript:alert(1)",
  "/%2F%2Fevil.example",
  "dashboard",
  "",
  ...DOT_SEGMENT_ESCAPES,
];

describe("login redirectTo", () => {
  it("goes to /dashboard when no return path is given", async () => {
    await mount();
    await act(() => auth.login(USER.email, "placeholder-password"));
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("goes to a same-origin return path", async () => {
    await mount();
    await act(() => auth.login(USER.email, "placeholder-password", "/accept-invitation"));
    expect(push).toHaveBeenCalledWith("/accept-invitation");
    expect(push).not.toHaveBeenCalledWith("/dashboard");
  });

  it.each(UNSAFE)("falls back to /dashboard for %j", async (redirectTo) => {
    await mount();
    await act(() => auth.login(USER.email, "placeholder-password", redirectTo));
    expect(push).toHaveBeenCalledWith("/dashboard");
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe("register redirectTo", () => {
  it("goes to /dashboard when no return path is given", async () => {
    await mount();
    await act(() => auth.register(USER.email, "placeholder-password", USER.fullName));
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("goes to a same-origin return path", async () => {
    await mount();
    await act(() => auth.register(USER.email, "placeholder-password", USER.fullName, "/accept-invitation"));
    expect(push).toHaveBeenCalledWith("/accept-invitation");
  });

  it.each(UNSAFE)("falls back to /dashboard for %j", async (redirectTo) => {
    await mount();
    await act(() => auth.register(USER.email, "placeholder-password", USER.fullName, redirectTo));
    expect(push).toHaveBeenCalledWith("/dashboard");
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe.each([
  ["login", (redirectTo?: string) => auth.login(USER.email, "placeholder-password", redirectTo)],
  ["register", (redirectTo?: string) => auth.register(USER.email, "placeholder-password", USER.fullName, redirectTo)],
] as const)("%s with a pending invitation", (_name, signIn) => {
  beforeEach(() => {
    savePendingInvitation("pending-invite-placeholder");
  });

  it("goes to /accept-invitation when no return path is given", async () => {
    await mount();
    await act(() => signIn());
    expect(push).toHaveBeenCalledWith("/accept-invitation");
    expect(push).toHaveBeenCalledTimes(1);
  });

  it.each(["//evil.example", "/..//evil.example"])("goes to /accept-invitation for the unsafe %j", async (redirectTo) => {
    await mount();
    await act(() => signIn(redirectTo));
    expect(push).toHaveBeenCalledWith("/accept-invitation");
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("a safe return path still wins", async () => {
    await mount();
    await act(() => signIn("/settings/sso"));
    expect(push).toHaveBeenCalledWith("/settings/sso");
  });

  it("an expired pending invitation does not redirect", async () => {
    sessionStorage.setItem(PENDING_INVITATION_KEY, JSON.stringify({ token: "old-placeholder", savedAt: 1 }));
    await mount();
    await act(() => signIn());
    expect(push).toHaveBeenCalledWith("/dashboard");
  });
});

describe("logout", () => {
  it("clears a pending invitation", async () => {
    savePendingInvitation("pending-invite-placeholder");
    await mount();
    await act(() => auth.logout());
    expect(sessionStorage.getItem(PENDING_INVITATION_KEY)).toBeNull();
  });
});

describe("session expiry (refreshUser 401, no refresh token)", () => {
  it("keeps a pending invitation, so signing in again still returns to it", async () => {
    // An invitee whose browser holds an expired session opens the invitation:
    // the page saves it, then the background refresh is rejected and the
    // provider sends them to /login with no ?from=. Clearing the invitation
    // here would lose it, so this path leaves it for the next sign-in.
    localStorage.setItem("accessToken", "expired-access-placeholder");
    localStorage.setItem("user", JSON.stringify(USER));
    savePendingInvitation("pending-invite-placeholder");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(authService, "getCurrentUser").mockRejectedValue({ response: { status: 401 } });

    await mount();
    await act(async () => {});

    expect(push).toHaveBeenCalledWith("/login");
    expect(localStorage.getItem("accessToken")).toBeNull();
    expect(sessionStorage.getItem(PENDING_INVITATION_KEY)).not.toBeNull();

    push.mockClear();
    await act(() => auth.login(USER.email, "placeholder-password"));
    expect(push).toHaveBeenCalledWith("/accept-invitation");
  });
});
