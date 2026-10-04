/**
 * Verify email: the token is taken from the link (in the fragment, as sent
 * by the backend, or in the legacy query string), removed from the URL
 * before the verification request is made, and the page reports what the
 * API answered.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import VerifyEmailPage from "../page";
import { authService } from "@/lib/services/auth.service";

const TOKEN = "a".repeat(32) + "0123456789abcdef0123456789abcdef";

function visit(path: string) {
  window.history.replaceState(null, "", path);
}

function apiError(status: number, error: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { success: false, error } },
  });
}

let verifyEmail: ReturnType<typeof vi.spyOn>;
const hrefWhenCalled: string[] = [];

beforeEach(() => {
  hrefWhenCalled.length = 0;
  verifyEmail = vi.spyOn(authService, "verifyEmail").mockImplementation(async () => {
    hrefWhenCalled.push(window.location.href);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  visit("/");
});

describe("verify email page", () => {
  it.each([
    ["legacy query string", `/verify-email?token=${TOKEN}`],
    ["fragment (the link the backend sends)", `/verify-email#token=${TOKEN}`],
  ])("%s: verifies with the token and shows success", async (_form, link) => {
    visit(link);

    render(<VerifyEmailPage />);

    expect(await screen.findByText("Email verified")).toBeInTheDocument();
    expect(verifyEmail).toHaveBeenCalledTimes(1);
    expect(verifyEmail).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByRole("link", { name: /continue to sign in/i })).toHaveAttribute("href", "/login");
  });

  it.each([
    ["legacy query string", `/verify-email?token=${TOKEN}`],
    ["fragment", `/verify-email#token=${TOKEN}`],
  ])("%s: the token is out of the URL before the request is made, and stays out", async (_form, link) => {
    visit(link);

    render(<VerifyEmailPage />);

    await screen.findByText("Email verified");
    expect(hrefWhenCalled).toHaveLength(1);
    expect(hrefWhenCalled[0]).not.toContain(TOKEN);
    expect(window.location.pathname).toBe("/verify-email");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(JSON.stringify(window.history.state)).not.toContain(TOKEN);
  });

  it("an invalid, used or expired token (API 400) shows the invalid-or-expired state", async () => {
    visit(`/verify-email?token=${TOKEN}`);
    verifyEmail.mockRejectedValue(apiError(400, "Invalid or expired verification token"));

    render(<VerifyEmailPage />);

    expect(await screen.findByText("Link invalid or expired")).toBeInTheDocument();
    expect(screen.queryByText("Email verified")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to sign in/i })).toHaveAttribute("href", "/login");
  });

  it.each([
    ["a network failure", Object.assign(new Error("Network Error"), { response: undefined })],
    ["a server error", apiError(500, "Internal server error")],
    ["rate limiting", apiError(429, "Too many requests")],
  ])("%s shows the try-again state, not success", async (_label, error) => {
    visit(`/verify-email?token=${TOKEN}`);
    verifyEmail.mockRejectedValue(error);

    render(<VerifyEmailPage />);

    expect(await screen.findByText("Couldn't verify your email")).toBeInTheDocument();
    expect(screen.queryByText("Email verified")).not.toBeInTheDocument();
  });

  it("a link without a token shows the invalid-link state and makes no request", async () => {
    visit("/verify-email");

    render(<VerifyEmailPage />);

    expect(await screen.findByText("Invalid verification link")).toBeInTheDocument();
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it("never renders the token or the API's error text", async () => {
    visit(`/verify-email?token=${TOKEN}`);
    verifyEmail.mockRejectedValue(apiError(400, "Invalid or expired verification token"));

    const { container } = render(<VerifyEmailPage />);

    await screen.findByText("Link invalid or expired");
    expect(container.textContent).not.toContain(TOKEN);
    expect(container.textContent).not.toContain("Invalid or expired verification token");
  });

  it("verifies only once under React Strict Mode, without flashing the missing-token state", async () => {
    visit(`/verify-email?token=${TOKEN}`);
    let finish!: () => void;
    verifyEmail.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));

    render(
      <React.StrictMode>
        <VerifyEmailPage />
      </React.StrictMode>
    );

    // Effects have run twice; the request is still pending.
    expect(await screen.findByText("Verifying your email")).toBeInTheDocument();
    expect(screen.queryByText("Invalid verification link")).not.toBeInTheDocument();
    expect(verifyEmail).toHaveBeenCalledTimes(1);

    finish();
    expect(await screen.findByText("Email verified")).toBeInTheDocument();
    await waitFor(() => expect(verifyEmail).toHaveBeenCalledTimes(1));
  });
});
