/**
 * Login and register opened with ?from= (AuthGate, the invitation
 * page): `from` is read once, removed from the URL, and handed to the auth
 * context as the return path, which validates it (see auth-redirect.test).
 */
import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import LoginPage from "../login/page";
import RegisterPage from "../register/page";
import { loginPathReturningTo } from "@/lib/login-redirect";

const login = vi.fn();
const registerUser = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("@/lib/contexts/auth-context", () => ({
  useAuth: () => ({ login, register: registerUser }),
}));

// Radix Checkbox measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Placeholder values only.
const EMAIL = "placeholder-user@example.test";
const PASSWORD = "PLACEHOLDER-pw-1!";

function currentPath() {
  return window.location.pathname + window.location.search + window.location.hash;
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit() {
  fireEvent.submit(document.querySelector("form") as HTMLFormElement);
}

async function submitLogin() {
  await act(async () => {});
  type("Email", EMAIL);
  type("Password", PASSWORD);
  submit();
}

async function submitRegister() {
  await act(async () => {});
  type("Full name", "Placeholder User");
  type("Email", EMAIL);
  type("Password", PASSWORD);
  type("Confirm password", PASSWORD);
  fireEvent.click(screen.getByRole("checkbox"));
  submit();
}

beforeEach(() => {
  login.mockReset().mockResolvedValue(undefined);
  registerUser.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("?from= on login and register", () => {
  it("login removes from (keeping the SSO error) and signs in with it as the return path", async () => {
    window.history.replaceState(null, "", "/login?error=sso_failed&from=%2Faccept-invitation");

    render(<LoginPage />);
    expect(currentPath()).toBe("/login?error=sso_failed");

    await submitLogin();
    await waitFor(() => expect(login).toHaveBeenCalledWith(EMAIL, PASSWORD, "/accept-invitation"));
  });

  it("login keeps the return path through Strict Mode's second effect run", async () => {
    window.history.replaceState(null, "", "/login?from=%2Fsettings%2Fsso");

    render(
      <StrictMode>
        <LoginPage />
      </StrictMode>
    );
    expect(currentPath()).toBe("/login");

    await submitLogin();
    await waitFor(() => expect(login).toHaveBeenCalledWith(EMAIL, PASSWORD, "/settings/sso"));
  });

  it("login returns to the page AuthGate sent it from, query included", async () => {
    window.history.replaceState(null, "", loginPathReturningTo("/costs?range=30d"));
    expect(currentPath()).toBe("/login?from=%2Fcosts%3Frange%3D30d");

    render(<LoginPage />);
    expect(currentPath()).toBe("/login");

    await submitLogin();
    await waitFor(() => expect(login).toHaveBeenCalledWith(EMAIL, PASSWORD, "/costs?range=30d"));
  });

  it("login without from passes no return path", async () => {
    window.history.replaceState(null, "", "/login");

    render(<LoginPage />);

    await submitLogin();
    await waitFor(() => expect(login).toHaveBeenCalledWith(EMAIL, PASSWORD, undefined));
  });

  it("register removes from and registers with it as the return path", async () => {
    window.history.replaceState(null, "", "/register?from=%2Faccept-invitation");

    render(<RegisterPage />);
    expect(currentPath()).toBe("/register");

    await submitRegister();
    await waitFor(() =>
      expect(registerUser).toHaveBeenCalledWith(EMAIL, PASSWORD, "Placeholder User", "/accept-invitation")
    );
  });

  it("an unsafe from is still removed from the URL (and left to the auth context to reject)", () => {
    window.history.replaceState(null, "", "/login?from=%2F%2Fevil.example");

    render(<LoginPage />);

    expect(currentPath()).toBe("/login");
  });
});
