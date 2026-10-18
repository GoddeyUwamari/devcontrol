/**
 * Accept invitation: the token is taken from the link (#token=, or ?token=
 * for emails sent before the link moved to the fragment) and removed from
 * the URL, kept in this tab's pending invitation so it survives sign-in or
 * registration, and never put into any rendered link or return path.
 */
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AcceptInvitationPage from "../page";
import {
  PENDING_INVITATION_KEY,
  PENDING_INVITATION_MAX_AGE_MS,
  savePendingInvitation,
} from "@/lib/pending-invitation";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseAuth = vi.fn();
vi.mock("@/lib/contexts/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockAcceptInvitation = vi.fn();
const mockRefreshOrganizations = vi.fn();
vi.mock("@/lib/services/organizations.service", () => ({
  organizationsService: {
    acceptInvitation: (...args: unknown[]) => mockAcceptInvitation(...args),
  },
}));

const TOKEN = "secret-invite-token-123";

function visit(path: string) {
  window.history.replaceState(null, "", path);
}

function currentPath() {
  return window.location.pathname + window.location.search + window.location.hash;
}

function pendingToken(): string | null {
  const raw = sessionStorage.getItem(PENDING_INVITATION_KEY);
  return raw === null ? null : JSON.parse(raw).token;
}

function setAuth(overrides: Partial<ReturnType<typeof baseAuth>> = {}) {
  mockUseAuth.mockReturnValue({ ...baseAuth(), ...overrides });
}

function signedIn() {
  setAuth({ isAuthenticated: true, user: { id: "u1" } });
}

function baseAuth() {
  return {
    user: null as null | { id: string },
    isAuthenticated: false,
    isLoading: false,
    refreshOrganizations: mockRefreshOrganizations,
  };
}

function expectNoTokenInAnyHref(container: HTMLElement) {
  for (const el of Array.from(container.querySelectorAll("[href]"))) {
    const href = el.getAttribute("href") ?? "";
    expect(href).not.toContain(TOKEN);
    expect(decodeURIComponent(href)).not.toContain(TOKEN);
    expect(href).not.toMatch(/token=/);
  }
}

describe("AcceptInvitationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    sessionStorage.clear();
    mockRefreshOrganizations.mockResolvedValue(undefined);
    visit(`/accept-invitation#token=${TOKEN}`);
    setAuth();
  });

  afterEach(() => {
    visit("/");
  });

  describe("reading the link", () => {
    it("takes #token from the fragment, removes it from the URL and keeps it as the pending invitation", async () => {
      signedIn();
      mockAcceptInvitation.mockReturnValue(new Promise(() => {}));

      render(<AcceptInvitationPage />);

      expect(currentPath()).toBe("/accept-invitation");
      expect(window.location.href).not.toContain(TOKEN);
      expect(pendingToken()).toBe(TOKEN);
      fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
      await waitFor(() => expect(mockAcceptInvitation).toHaveBeenCalledWith(TOKEN));
    });

    it("accepts a legacy ?token link (emails sent before the fragment form) and removes it from the URL", async () => {
      visit(`/accept-invitation?token=${TOKEN}`);
      signedIn();
      mockAcceptInvitation.mockReturnValue(new Promise(() => {}));

      render(<AcceptInvitationPage />);

      expect(currentPath()).toBe("/accept-invitation");
      expect(window.location.href).not.toContain(TOKEN);
      expect(pendingToken()).toBe(TOKEN);
      fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
      await waitFor(() => expect(mockAcceptInvitation).toHaveBeenCalledWith(TOKEN));
    });

    it("prefers the fragment when a link carries both forms", async () => {
      visit(`/accept-invitation?token=OLDQUERYTOKEN#token=${TOKEN}`);
      signedIn();
      mockAcceptInvitation.mockReturnValue(new Promise(() => {}));

      render(<AcceptInvitationPage />);

      expect(currentPath()).toBe("/accept-invitation");
      fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
      await waitFor(() => expect(mockAcceptInvitation).toHaveBeenCalledWith(TOKEN));
    });

    it("keeps the token through React Strict Mode's second effect run", async () => {
      signedIn();
      mockAcceptInvitation.mockReturnValue(new Promise(() => {}));

      render(
        <StrictMode>
          <AcceptInvitationPage />
        </StrictMode>
      );

      expect(screen.queryByText(/invalid invitation link/i)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
      await waitFor(() => expect(mockAcceptInvitation).toHaveBeenCalledWith(TOKEN));
      expect(pendingToken()).toBe(TOKEN);
    });

    it("shows a reading state, not the invalid-link state, before the link has been read", () => {
      signedIn();

      const html = renderToString(<AcceptInvitationPage />);

      expect(html).toMatch(/Reading invitation link/);
      expect(html).not.toMatch(/Invalid invitation link/i);
      expect(html).not.toContain(TOKEN);
    });

    it("shows the invalid-invitation state when there is no token and no pending invitation", () => {
      visit("/accept-invitation");
      signedIn();

      render(<AcceptInvitationPage />);

      expect(screen.getByText(/invalid invitation link/i)).toBeInTheDocument();
      expect(mockAcceptInvitation).not.toHaveBeenCalled();
    });

    it("uses the pending invitation when the user returns without a token in the URL", async () => {
      savePendingInvitation(TOKEN);
      visit("/accept-invitation");
      signedIn();
      mockAcceptInvitation.mockReturnValue(new Promise(() => {}));

      render(<AcceptInvitationPage />);

      fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
      await waitFor(() => expect(mockAcceptInvitation).toHaveBeenCalledWith(TOKEN));
    });

    it("ignores and removes a pending invitation older than 7 days", () => {
      savePendingInvitation(TOKEN, Date.now() - PENDING_INVITATION_MAX_AGE_MS - 1);
      visit("/accept-invitation");
      signedIn();

      render(<AcceptInvitationPage />);

      expect(screen.getByText(/invalid invitation link/i)).toBeInTheDocument();
      expect(sessionStorage.getItem(PENDING_INVITATION_KEY)).toBeNull();
    });

    it("a new link replaces an older pending invitation", () => {
      savePendingInvitation("older-pending-invitation-token");

      render(<AcceptInvitationPage />);

      expect(pendingToken()).toBe(TOKEN);
    });
  });

  describe("signed out", () => {
    it.each([
      ["#token", `/accept-invitation#token=${TOKEN}`],
      ["legacy ?token", `/accept-invitation?token=${TOKEN}`],
    ])("%s: offers Sign in / Create account returning to /accept-invitation, with no token in any link", (_form, link) => {
      visit(link);
      setAuth({ isAuthenticated: false, user: null, isLoading: false });

      const { container } = render(<AcceptInvitationPage />);

      const signIn = screen.getByRole("link", { name: /sign in/i });
      const createAccount = screen.getByRole("link", { name: /create an account/i });
      expect(signIn).toHaveAttribute("href", "/login?from=%2Faccept-invitation");
      expect(createAccount).toHaveAttribute("href", "/register?from=%2Faccept-invitation");
      expectNoTokenInAnyHref(container);
      expect(container.innerHTML).not.toContain(TOKEN);
      // Kept for after sign-in instead.
      expect(pendingToken()).toBe(TOKEN);
      expect(mockAcceptInvitation).not.toHaveBeenCalled();
    });
  });

  it("shows an explicit Accept invitation action for authenticated users and does not auto-fire", () => {
    signedIn();

    render(<AcceptInvitationPage />);

    expect(screen.getByRole("button", { name: /accept invitation/i })).toBeInTheDocument();
    expect(mockAcceptInvitation).not.toHaveBeenCalled();
  });

  it("prevents repeated submission while the request is in progress", async () => {
    signedIn();

    let resolveAccept: (value: { organizationId: string; role: string }) => void;
    mockAcceptInvitation.mockReturnValue(
      new Promise((resolve) => {
        resolveAccept = resolve;
      })
    );

    render(<AcceptInvitationPage />);
    const button = screen.getByRole("button", { name: /accept invitation/i });

    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());

    // Clicking again while disabled must not trigger a second call --
    // jsdom (like real browsers) does not dispatch click on a disabled
    // native button.
    fireEvent.click(button);

    resolveAccept!({ organizationId: "org-1", role: "member" });
    await waitFor(() => expect(mockRefreshOrganizations).toHaveBeenCalled());

    expect(mockAcceptInvitation).toHaveBeenCalledTimes(1);

    // Drain the component's own success-redirect timer before this test
    // ends, so it can't fire during a later test and pollute mockPush there.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"), {
      timeout: 3000,
    });
  });

  it("refreshes organizations, clears the pending invitation and navigates to /dashboard on success", async () => {
    signedIn();
    mockAcceptInvitation.mockResolvedValue({
      organizationId: "org-1",
      role: "member",
    });

    const { container } = render(<AcceptInvitationPage />);
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    await waitFor(() => expect(mockRefreshOrganizations).toHaveBeenCalledTimes(1));
    // Awaited: the success state is set after refreshOrganizations() resolves,
    // a later step than the call the waitFor above observed.
    expect(await screen.findByText(/invitation accepted/i)).toBeInTheDocument();
    expect(sessionStorage.getItem(PENDING_INVITATION_KEY)).toBeNull();
    expectNoTokenInAnyHref(container);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"), {
      timeout: 3000,
    });
  });

  it("treats 'already a member' as a soft success, clears the pending invitation and redirects to /dashboard", async () => {
    signedIn();
    mockAcceptInvitation.mockRejectedValue({
      response: { status: 400, data: { error: "User is already a member of this organization" } },
    });

    render(<AcceptInvitationPage />);
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    expect(await screen.findByText(/already a member/i)).toBeInTheDocument();
    expect(sessionStorage.getItem(PENDING_INVITATION_KEY)).toBeNull();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"), {
      timeout: 3000,
    });
  });

  it("displays backend error messages and clears the pending invitation on a terminal error", async () => {
    signedIn();
    mockAcceptInvitation.mockRejectedValue({
      response: { status: 403, data: { error: "This invitation was sent to a different email address" } },
    });

    const { container } = render(<AcceptInvitationPage />);
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    expect(
      await screen.findByText("This invitation was sent to a different email address")
    ).toBeInTheDocument();
    expect(sessionStorage.getItem(PENDING_INVITATION_KEY)).toBeNull();
    expectNoTokenInAnyHref(container);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it.each([
    ["a server error", { response: { status: 503, data: { error: "Service unavailable" } } }, "Service unavailable"],
    ["a rate limit", { response: { status: 429, data: { error: "Too many requests" } } }, "Too many requests"],
    ["a network error", { message: "Network Error" }, "Failed to accept invitation"],
  ])("keeps the pending invitation after %s, which may succeed on retry", async (_kind, error, shown) => {
    signedIn();
    mockAcceptInvitation.mockRejectedValue(error);

    render(<AcceptInvitationPage />);
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    expect(await screen.findByText(shown)).toBeInTheDocument();
    expect(pendingToken()).toBe(TOKEN);
  });

  it("never renders or logs the raw invitation token on error", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    signedIn();
    mockAcceptInvitation.mockRejectedValue({
      response: { status: 410, data: { error: "Invalid or expired invitation" } },
    });

    const { container } = render(<AcceptInvitationPage />);
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    await screen.findByText("Invalid or expired invitation");

    expect(container.innerHTML).not.toContain(TOKEN);
    for (const call of consoleErrorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(TOKEN);
    }

    consoleErrorSpy.mockRestore();
  });
});
