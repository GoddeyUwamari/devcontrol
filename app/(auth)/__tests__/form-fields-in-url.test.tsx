/**
 * Login and register opened with form fields in the query string -- what a
 * native GET submit before hydration produces: the fields are removed from
 * the URL on mount and are not used or sent anywhere. Other params (the SSO
 * error) are kept.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import LoginPage from "../login/page";
import RegisterPage from "../register/page";

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
const PASSWORD = "PLACEHOLDER-pw-1";

let fetchSpy: ReturnType<typeof vi.spyOn>;
let beacon: ReturnType<typeof vi.fn>;

beforeEach(() => {
  login.mockReset();
  registerUser.mockReset();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
  beacon = vi.fn();
  Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

function expectNothingSent() {
  expect(login).not.toHaveBeenCalled();
  expect(registerUser).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(beacon).not.toHaveBeenCalled();
}

describe("form fields in the URL", () => {
  it("login removes email, password and rememberMe from the URL, keeps the SSO error, and sends nothing", async () => {
    const query = new URLSearchParams({ error: "sso_failed", email: EMAIL, password: PASSWORD, rememberMe: "on" });
    window.history.replaceState(null, "", `/login?${query}`);

    render(<LoginPage />);

    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe("/login?error=sso_failed");
    expect(window.location.href).not.toContain("PLACEHOLDER");
    expect(JSON.stringify(window.history.state)).not.toContain("PLACEHOLDER");
    // The fields are not prefilled from the URL either.
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expectNothingSent();
  });

  it("register removes every form field from the URL and sends nothing", async () => {
    const query = new URLSearchParams({
      fullName: "Placeholder Name",
      email: EMAIL,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      termsAccepted: "on",
    });
    window.history.replaceState(null, "", `/register?${query}`);

    render(<RegisterPage />);

    expect(await screen.findByRole("button", { name: /create account/i })).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe("/register");
    expect(window.location.href).not.toContain("PLACEHOLDER");
    expect(JSON.stringify(window.history.state)).not.toContain("PLACEHOLDER");
    expectNothingSent();
  });

  it("login opened without fields leaves the URL as it is", async () => {
    window.history.replaceState(null, "", "/login?error=sso_failed");
    const replaceState = vi.spyOn(window.history, "replaceState");

    render(<LoginPage />);

    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search).toBe("/login?error=sso_failed");
  });
});
