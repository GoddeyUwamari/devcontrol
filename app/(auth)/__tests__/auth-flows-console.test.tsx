/**
 * Login, register, forgot password and reset password: when the API rejects
 * the request, what reaches the console is the logError line only -- never
 * the submitted password, reset token, email, or the Authorization header.
 *
 * Every request fails at the axios adapter, so each page handles a genuine
 * AxiosError built from what it really sent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/contexts/auth-context";
import LoginPage from "../login/page";
import RegisterPage from "../register/page";
import ForgotPasswordPage from "../forgot-password/page";
import ResetPasswordPage from "../reset-password/page";
import {
  SENTINEL_PASSWORD,
  SENTINEL_TOKEN,
  expectNoSentinelInConsole,
  rejectEveryApiRequest,
  spyOnConsole,
} from "@/lib/__tests__/support/console-sentinels";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));

const EMAIL = "sentinel-user-5d2c@example.test";
const REJECTED = "Request failed with status code 400 (status 400, code BAD_REQUEST)";

let restoreApi: () => void;
let spies: ReturnType<typeof spyOnConsole>;

// Radix Checkbox measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => {
  push.mockReset();
  restoreApi = rejectEveryApiRequest();
  spies = spyOnConsole();
});

afterEach(() => {
  restoreApi();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

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

function submit() {
  fireEvent.submit(document.querySelector("form") as HTMLFormElement);
}

function errorLines(): unknown[][] {
  return vi.mocked(console.error).mock.calls;
}

describe("auth flows log no credentials", () => {
  it("login", async () => {
    render(withAuth(<LoginPage />));
    await act(async () => {});
    type("Email", EMAIL);
    type("Password", SENTINEL_PASSWORD);
    submit();

    await waitFor(() => expect(errorLines()).toContainEqual([`Login failed: ${REJECTED}`]));
    // logged once, by the auth context
    expect(errorLines().filter(([line]) => String(line).startsWith("Login"))).toHaveLength(1);
    expectNoSentinelInConsole(spies, [EMAIL]);
  });

  it("register", async () => {
    render(withAuth(<RegisterPage />));
    await act(async () => {});
    type("Full name", "Sentinel User");
    type("Email", EMAIL);
    type("Password", SENTINEL_PASSWORD);
    type("Confirm password", SENTINEL_PASSWORD);
    fireEvent.click(screen.getByRole("checkbox"));
    submit();

    await waitFor(() => expect(errorLines()).toContainEqual([`Registration failed: ${REJECTED}`]));
    expect(errorLines().filter(([line]) => String(line).startsWith("Registration"))).toHaveLength(1);
    expectNoSentinelInConsole(spies, [EMAIL]);
  });

  it("forgot password", async () => {
    render(<ForgotPasswordPage />);
    type("Email", EMAIL);
    submit();

    await waitFor(() => expect(errorLines()).toContainEqual([`Forgot password error: ${REJECTED}`]));
    expectNoSentinelInConsole(spies, [EMAIL]);
  });

  it("reset password", async () => {
    window.history.replaceState(null, "", `/reset-password#token=${SENTINEL_TOKEN}`);
    render(<ResetPasswordPage />);
    await screen.findByLabelText("New password");
    type("New password", SENTINEL_PASSWORD);
    type("Confirm new password", SENTINEL_PASSWORD);
    submit();

    await waitFor(() => expect(errorLines()).toContainEqual([`Reset password error: ${REJECTED}`]));
    expectNoSentinelInConsole(spies);
  });
});
