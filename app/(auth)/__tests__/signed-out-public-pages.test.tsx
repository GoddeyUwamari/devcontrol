/**
 * Public pages stay reachable signed out: they sit outside AuthGate (see
 * app/__tests__/route-auth-sweep.test.ts). An invitee opening their link in a
 * fresh browser gets the invitation page, inside the (auth) layout, with no
 * redirect -- the page itself offers sign-in with the token kept out of URLs.
 *
 * Runs the real AuthProvider, signed out; navigation is faked. Placeholder
 * values only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/contexts/auth-context";
import { PENDING_INVITATION_KEY } from "@/lib/pending-invitation";
import AuthLayout from "../layout";
import AcceptInvitationPage from "../accept-invitation/page";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const TOKEN = "invite-placeholder-token-0123456789";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  push.mockReset();
  replace.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("signed out", () => {
  it("/accept-invitation#token=… renders the invitation page, with no redirect", async () => {
    window.history.replaceState(null, "", `/accept-invitation#token=${TOKEN}`);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <AuthLayout>
            <AcceptInvitationPage />
          </AuthLayout>
        </AuthProvider>
      </QueryClientProvider>
    );
    await act(async () => {});

    expect(screen.getByText("Sign in to accept invitation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute(
      "href",
      "/login?from=%2Faccept-invitation"
    );
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/accept-invitation");
    expect(window.location.href).not.toContain(TOKEN);
    expect(sessionStorage.getItem(PENDING_INVITATION_KEY)).toContain(TOKEN);
  });
});
