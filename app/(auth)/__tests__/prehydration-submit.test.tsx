/**
 * Login, register and forgot password before hydration: the server-rendered
 * form posts (never a GET that would put the fields in the URL) and its
 * submit button is disabled, which also blocks Enter's implicit submission.
 * Once hydrated, the same markup is adopted without a mismatch and the
 * button is enabled.
 */
import { describe, it, expect, vi } from "vitest";
import { act } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import LoginPage from "../login/page";
import RegisterPage from "../register/page";
import ForgotPasswordPage from "../forgot-password/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/contexts/auth-context", () => ({
  useAuth: () => ({ login: vi.fn(), register: vi.fn() }),
}));

// Radix Checkbox measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const PAGES: [string, () => ReactElement][] = [
  ["login", () => <LoginPage />],
  ["register", () => <RegisterPage />],
  ["forgot password", () => <ForgotPasswordPage />],
];

function submitButton(root: ParentNode): HTMLButtonElement {
  return root.querySelector('form button[type="submit"]') as HTMLButtonElement;
}

describe.each(PAGES)("%s before hydration", (_name, page) => {
  it("server HTML has a POST form with its submit button disabled", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(page());

    const forms = container.querySelectorAll("form");
    expect(forms).toHaveLength(1);
    expect(forms[0].getAttribute("method")).toBe("post");
    expect(submitButton(container).disabled).toBe(true);
  });

  it("hydrates without a mismatch and enables the submit button", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(page());
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();

    const root = await act(async () => hydrateRoot(container, page(), { onRecoverableError }));

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(submitButton(container).disabled).toBe(false);
    act(() => root.unmount());
    container.remove();
  });
});
