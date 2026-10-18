/**
 * A signed-out invitee who opens an invitation, goes to sign in, then follows
 * the login page's plain "Sign up" link (which carries no ?from=) and
 * registers still lands back on /accept-invitation: the pending invitation
 * drives the post-sign-in redirect.
 *
 * Runs the real pages and AuthProvider; the auth service and navigation are faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/contexts/auth-context";
import { authService } from "@/lib/services/auth.service";
import { organizationsService } from "@/lib/services/organizations.service";
import AcceptInvitationPage from "../accept-invitation/page";
import LoginPage from "../login/page";
import RegisterPage from "../register/page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// Radix Checkbox measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Placeholder values only.
const TOKEN = "invite-placeholder-token-0123456789";
const EMAIL = "placeholder-invitee@example.test";
const PASSWORD = "PLACEHOLDER-pw-1!";
const USER = { id: "user-1", email: EMAIL, fullName: "Placeholder Invitee" };

function withAuth(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  push.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(organizationsService, "getAll").mockResolvedValue([] as never);
  vi.spyOn(authService, "register").mockResolvedValue({
    data: { accessToken: "access-placeholder", refreshToken: "refresh-placeholder", user: USER },
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("invitation survives login → register", () => {
  it("signed out → login page → Sign up link → register → lands on /accept-invitation", async () => {
    // 1. The invitation link, signed out.
    window.history.replaceState(null, "", `/accept-invitation#token=${TOKEN}`);
    const invite = render(withAuth(<AcceptInvitationPage />));
    await act(async () => {});
    const signIn = screen.getByRole("link", { name: /^sign in$/i });
    expect(signIn).toHaveAttribute("href", "/login?from=%2Faccept-invitation");
    expect(window.location.href).not.toContain(TOKEN);
    invite.unmount();

    // 2. The login page; its Sign up link drops ?from=.
    window.history.replaceState(null, "", "/login?from=%2Faccept-invitation");
    const login = render(withAuth(<LoginPage />));
    await act(async () => {});
    expect(screen.getByRole("link", { name: /sign up/i })).toHaveAttribute("href", "/register");
    login.unmount();

    // 3. Register, with no ?from=.
    window.history.replaceState(null, "", "/register");
    const { container } = render(withAuth(<RegisterPage />));
    await act(async () => {});
    type("Full name", USER.fullName);
    type("Email", EMAIL);
    type("Password", PASSWORD);
    type("Confirm password", PASSWORD);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/accept-invitation"));
    expect(push).not.toHaveBeenCalledWith("/dashboard");
    for (const [path] of push.mock.calls) expect(String(path)).not.toContain(TOKEN);
  });
});
