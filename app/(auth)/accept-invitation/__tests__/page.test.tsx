import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AcceptInvitationPage from "../page";

const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
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

function setSearchParams(params: Record<string, string>) {
  mockSearchParams = new URLSearchParams(params);
}

function setAuth(overrides: Partial<ReturnType<typeof baseAuth>> = {}) {
  mockUseAuth.mockReturnValue({ ...baseAuth(), ...overrides });
}

function baseAuth() {
  return {
    user: null as null | { id: string },
    isAuthenticated: false,
    isLoading: false,
    refreshOrganizations: mockRefreshOrganizations,
  };
}

describe("AcceptInvitationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshOrganizations.mockResolvedValue(undefined);
    setSearchParams({});
    setAuth();
  });

  it("shows the invalid-invitation state when token is missing", () => {
    setSearchParams({});
    setAuth({ isAuthenticated: true, user: { id: "u1" } });

    render(<AcceptInvitationPage />);

    expect(
      screen.getByText(/invalid invitation link/i)
    ).toBeInTheDocument();
    expect(mockAcceptInvitation).not.toHaveBeenCalled();
  });

  it("offers Sign in / Create account for unauthenticated users, preserving the token in the return URL", () => {
    setSearchParams({ token: TOKEN });
    setAuth({ isAuthenticated: false, user: null, isLoading: false });

    render(<AcceptInvitationPage />);

    const signIn = screen.getByRole("link", { name: /sign in/i });
    const createAccount = screen.getByRole("link", { name: /create an account/i });

    const expectedReturnTo = encodeURIComponent(
      `/accept-invitation?token=${encodeURIComponent(TOKEN)}`
    );

    expect(signIn).toHaveAttribute(
      "href",
      `/login?from=${expectedReturnTo}`
    );
    expect(createAccount).toHaveAttribute(
      "href",
      `/register?from=${expectedReturnTo}`
    );
    expect(mockAcceptInvitation).not.toHaveBeenCalled();
  });

  it("shows an explicit Accept invitation action for authenticated users and does not auto-fire", () => {
    setSearchParams({ token: TOKEN });
    setAuth({ isAuthenticated: true, user: { id: "u1" } });

    render(<AcceptInvitationPage />);

    expect(
      screen.getByRole("button", { name: /accept invitation/i })
    ).toBeInTheDocument();
    expect(mockAcceptInvitation).not.toHaveBeenCalled();
  });

  it("calls acceptInvitation with the token when the button is clicked", async () => {
    setSearchParams({ token: TOKEN });
    setAuth({ isAuthenticated: true, user: { id: "u1" } });
    // Never resolves: this test only cares about the call arguments, not
    // the success flow -- avoids leaking the component's success-redirect
    // timer into a later test.
    mockAcceptInvitation.mockReturnValue(new Promise(() => {}));

    render(<AcceptInvitationPage />);
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    await waitFor(() => expect(mockAcceptInvitation).toHaveBeenCalledWith(TOKEN));
  });

  it("prevents repeated submission while the request is in progress", async () => {
    setSearchParams({ token: TOKEN });
    setAuth({ isAuthenticated: true, user: { id: "u1" } });

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

  it("refreshes organizations and navigates to /dashboard on success", async () => {
    setSearchParams({ token: TOKEN });
    setAuth({ isAuthenticated: true, user: { id: "u1" } });
    mockAcceptInvitation.mockResolvedValue({
      organizationId: "org-1",
      role: "member",
    });

    render(<AcceptInvitationPage />);
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    await waitFor(() => expect(mockRefreshOrganizations).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/invitation accepted/i)).toBeInTheDocument();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"), {
      timeout: 3000,
    });
  });

  it("displays backend error messages using the existing error-extraction convention", async () => {
    setSearchParams({ token: TOKEN });
    setAuth({ isAuthenticated: true, user: { id: "u1" } });
    mockAcceptInvitation.mockRejectedValue({
      response: { data: { error: "This invitation was sent to a different email address" } },
    });

    render(<AcceptInvitationPage />);
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    expect(
      await screen.findByText("This invitation was sent to a different email address")
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("treats 'already a member' as a soft success and redirects to /dashboard", async () => {
    setSearchParams({ token: TOKEN });
    setAuth({ isAuthenticated: true, user: { id: "u1" } });
    mockAcceptInvitation.mockRejectedValue({
      response: { data: { error: "User is already a member of this organization" } },
    });

    render(<AcceptInvitationPage />);
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    expect(await screen.findByText(/already a member/i)).toBeInTheDocument();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"), {
      timeout: 3000,
    });
  });

  it("never renders or logs the raw invitation token on error", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setSearchParams({ token: TOKEN });
    setAuth({ isAuthenticated: true, user: { id: "u1" } });
    mockAcceptInvitation.mockRejectedValue({
      response: { data: { error: "Invalid or expired invitation" } },
    });

    const { container } = render(<AcceptInvitationPage />);
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    await screen.findByText("Invalid or expired invitation");

    expect(container.textContent).not.toContain(TOKEN);
    for (const call of consoleErrorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(TOKEN);
    }

    consoleErrorSpy.mockRestore();
  });
});
