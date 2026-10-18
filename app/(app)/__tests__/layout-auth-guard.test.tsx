/**
 * The real app layout, signed out: none of the shell renders (no header, no
 * "Sign in" link, no "your organization", no "Live updates paused"), nothing
 * in it calls the API, and the visitor is replaced to /login?from=<this page>.
 * Production showed the signed-out shell because this layout had no guard.
 *
 * Runs the real AuthProvider; navigation is faked and every HTTP request is
 * caught, so a call made before sign-in fails the test.
 */
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios from "axios";
import api from "@/lib/api";
import { AuthProvider } from "@/lib/contexts/auth-context";
import AppLayout from "../layout";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const requests: string[] = [];
const adapters = { api: api.defaults.adapter, axios: axios.defaults.adapter };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  requests.length = 0;
  push.mockReset();
  replace.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  const refuse = (config: { url?: string }) => {
    requests.push(String(config.url));
    return Promise.reject(new Error("no request may be made signed out"));
  };
  api.defaults.adapter = refuse as never;
  axios.defaults.adapter = refuse as never;
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    requests.push(String(input));
    return Promise.reject(new Error("no request may be made signed out"));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  api.defaults.adapter = adapters.api;
  axios.defaults.adapter = adapters.axios;
  window.history.replaceState(null, "", "/");
});

it.each([
  ["/dashboard", "/login?from=%2Fdashboard"],
  ["/costs?range=30d", "/login?from=%2Fcosts%3Frange%3D30d"],
  ["/settings/organization", "/login?from=%2Fsettings%2Forganization"],
])("signed out on %s: no shell, no requests, replaced to %s", async (path, target) => {
  window.history.replaceState(null, "", path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <AppLayout>
          <p>page content</p>
        </AppLayout>
      </AuthProvider>
    </QueryClientProvider>
  );
  await act(async () => {});

  expect(replace).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenCalledWith(target);
  expect(push).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByRole("banner")).toBeNull();
  expect(screen.queryByRole("main")).toBeNull();
  expect(screen.queryByText("page content")).toBeNull();
  expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
  expect(document.body.textContent).not.toMatch(/your organization|live updates paused/i);
  expect(requests).toEqual([]);
});
