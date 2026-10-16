/**
 * Reset password: the reset token is taken from the link fragment, removed
 * from the URL straight away, kept only in the page's state, and still sent
 * with the reset request. A token in the query string is not used.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ResetPasswordPage from "../page";
import { authService } from "@/lib/services/auth.service";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const RESET_TOKEN = "reset-token-0123456789abcdef";
const NEW_PASSWORD = "Str0ng!Passw0rd";

function visit(path: string) {
  window.history.replaceState(null, "", path);
}

async function submitNewPassword() {
  fireEvent.change(await screen.findByLabelText("New password"), { target: { value: NEW_PASSWORD } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: NEW_PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: /reset password/i }));
}

let resetPassword: ReturnType<typeof vi.spyOn>;
const hrefWhenSubmitted: string[] = [];

beforeEach(() => {
  push.mockReset();
  hrefWhenSubmitted.length = 0;
  resetPassword = vi.spyOn(authService, "resetPassword").mockImplementation(async () => {
    hrefWhenSubmitted.push(window.location.href);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  visit("/");
});

describe("reset password link", () => {
  it("the token is removed from the URL as soon as the page loads", async () => {
    visit(`/reset-password#token=${RESET_TOKEN}`);

    render(<ResetPasswordPage />);

    expect(await screen.findByLabelText("New password")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/reset-password");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(RESET_TOKEN);
  });

  it("the reset request still receives the token, from page state", async () => {
    visit(`/reset-password#token=${RESET_TOKEN}`);

    render(<ResetPasswordPage />);
    await submitNewPassword();

    await waitFor(() => expect(resetPassword).toHaveBeenCalledTimes(1));
    expect(resetPassword).toHaveBeenCalledWith({ token: RESET_TOKEN, password: NEW_PASSWORD });
    // The URL was already clean when the request was made.
    expect(hrefWhenSubmitted[0]).not.toContain(RESET_TOKEN);
  });

  it("a link without a token shows the invalid-link state and never calls the API", async () => {
    visit("/reset-password");

    render(<ResetPasswordPage />);

    expect(await screen.findByText(/missing or invalid/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("a ?token= link shows the invalid-link state, never calls the API, and is removed from the URL and history", async () => {
    const link = `/reset-password?token=${RESET_TOKEN}`;
    // Shape Next.js stores: the page segment keeps the URL it was loaded with.
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["", { children: ["__PAGE__", {}, link, "refresh"] }] }, "", link);

    render(<ResetPasswordPage />);
    // Before the deferred re-apply replaces the state: the router's copy is clean.
    const stateAfterLoad = JSON.stringify(window.history.state);
    expect(stateAfterLoad).toContain("__PAGE__");

    expect(await screen.findByText(/missing or invalid/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/reset-password");
    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain(RESET_TOKEN);
    expect(stateAfterLoad).not.toContain(RESET_TOKEN);
    expect(JSON.stringify(window.history.state)).not.toContain(RESET_TOKEN);
  });
});
