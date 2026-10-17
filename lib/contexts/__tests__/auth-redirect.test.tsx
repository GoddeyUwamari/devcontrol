/**
 * login() and register() go to a caller's return path once signed in, but
 * only a same-origin path (safeReturnPath); anything else falls back to
 * /dashboard. logout() forgets a pending invitation.
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

describe("logout", () => {
  it("clears a pending invitation", async () => {
    savePendingInvitation("pending-invite-placeholder");
    await mount();
    await act(() => auth.logout());
    expect(sessionStorage.getItem(PENDING_INVITATION_KEY)).toBeNull();
  });
});
