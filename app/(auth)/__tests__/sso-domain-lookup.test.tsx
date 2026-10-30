/**
 * "Sign in with SSO" on the login page: the email's domain is looked up with
 * GET /api/auth/saml/check-domain, and the browser is sent to the SSO start
 * path the answer names -- never anywhere else. The answer carries no
 * organization id; one from a backend deployed before that change still
 * starts SSO (temporary fallback, see lib/sso-initiate.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginPage from "../login/page";
import { goToSso } from "@/lib/sso-initiate";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("@/lib/contexts/auth-context", () => ({
  useAuth: () => ({ login: vi.fn() }),
}));

vi.mock("@/lib/sso-initiate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sso-initiate")>()),
  goToSso: vi.fn(),
}));

// Radix Checkbox measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const ORG_ID = "00000000-0000-4000-8000-00000000000a";
const NO_SSO = "No SSO is configured for this domain. Contact your administrator.";
const LOOKUP_FAILED = "Failed to look up SSO configuration. Please try again.";

let fetchSpy: ReturnType<typeof vi.spyOn>;

function answer(body: unknown, status = 200) {
  fetchSpy.mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

async function signInWithSso(email: string) {
  render(<LoginPage />);
  fireEvent.click(await screen.findByRole("button", { name: /Sign in with SSO/ }));
  fireEvent.change(screen.getByPlaceholderText("your@company.com"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  vi.mocked(goToSso).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("SSO domain lookup", () => {
  it("looks up the email's domain and goes to the start path the backend names", async () => {
    answer({ success: true, data: { hasSSO: true, initiatePath: "/api/auth/saml/initiate?domain=example.test" } });

    await signInWithSso("person@example.test");

    await waitFor(() => expect(goToSso).toHaveBeenCalledWith(`${API}/api/auth/saml/initiate?domain=example.test`));
    expect(fetchSpy).toHaveBeenCalledWith(`${API}/api/auth/saml/check-domain?domain=example.test`);
  });

  it("a domain without SSO shows the message and goes nowhere", async () => {
    answer({ success: true, data: { hasSSO: false } });

    await signInWithSso("person@example.test");

    expect(await screen.findByText(NO_SSO)).toBeInTheDocument();
    expect(goToSso).not.toHaveBeenCalled();
  });

  it("a failed lookup shows the lookup error and goes nowhere", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));

    await signInWithSso("person@example.test");

    expect(await screen.findByText(LOOKUP_FAILED)).toBeInTheDocument();
    expect(goToSso).not.toHaveBeenCalled();
  });

  it.each([
    ["no start path", { hasSSO: true }],
    ["an absolute URL", { hasSSO: true, initiatePath: "https://evil.example/api/auth/saml/initiate?domain=x" }],
    ["a protocol-relative URL", { hasSSO: true, initiatePath: "//evil.example/api/auth/saml/initiate?domain=x" }],
    ["another API path", { hasSSO: true, initiatePath: "/api/auth/logout?x=1" }],
    ["a non-string path", { hasSSO: true, initiatePath: { href: "/api/auth/saml/initiate?domain=x" } }],
    ["a start path alongside an organization id", { hasSSO: true, initiatePath: "https://evil.example", organizationId: ORG_ID }],
    ["an organization id that is not a UUID", { hasSSO: true, organizationId: "../../evil" }],
  ])("a malformed answer (%s) shows the lookup error and goes nowhere", async (_label, data) => {
    answer({ success: true, data });

    await signInWithSso("person@example.test");

    expect(await screen.findByText(LOOKUP_FAILED)).toBeInTheDocument();
    expect(goToSso).not.toHaveBeenCalled();
  });

  it("TEMPORARY: an answer from the previous backend (organization id) still starts SSO", async () => {
    answer({ success: true, data: { hasSSO: true, organizationId: ORG_ID, providerName: "Okta" } });

    await signInWithSso("person@example.test");

    await waitFor(() => expect(goToSso).toHaveBeenCalledWith(`${API}/api/auth/saml/initiate?orgId=${ORG_ID}`));
  });
});
