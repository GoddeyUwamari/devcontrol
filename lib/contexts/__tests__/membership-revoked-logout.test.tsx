/**
 * A backend MEMBERSHIP_REVOKED response logs the user out promptly.
 *
 * Runs the real AuthProvider and the real lib/api.ts interceptor; only the
 * HTTP transport (axios adapter), the refresh call, and navigation are
 * faked. The backend answers MEMBERSHIP_REVOKED when the session's
 * organization membership has ended -- the refresh that follows is rejected
 * too, so the provider must log out once, without loops.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, REFRESH_RACE_RECHECK_MS } from "@/lib/contexts/auth-context";
import { authService } from "@/lib/services/auth.service";
import { api } from "@/lib/api";
import { organizationsService } from "@/lib/services/organizations.service";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

const REVOKED = { success: false, error: "Organization membership is not active", code: "MEMBERSHIP_REVOKED" };
const originalAdapter = api.defaults.adapter;

/** Every request through `api` gets this HTTP response (as an axios error when >= 400). */
function backendAnswers(status: number, data: unknown) {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    const response = { status, statusText: "", data, headers: {}, config };
    if (status >= 400) {
      throw new AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, response as never);
    }
    return response;
  });
  api.defaults.adapter = adapter as unknown as AxiosAdapter;
  return adapter;
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <div />
      </AuthProvider>
    </QueryClientProvider>
  );
  await act(async () => {});
}

/** Tokens this tab holds. No cached user, so mount doesn't run refreshUser itself. */
function seedTokens() {
  localStorage.setItem("accessToken", "access-old");
  localStorage.setItem("refreshToken", "refresh-old");
}

/** A data request from anywhere in the app; its failure is the caller's to show. */
async function someApiCall() {
  await api.get("/api/services").catch(() => undefined);
}

/** Lets refreshUser's single one-second rotation re-check elapse. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(REFRESH_RACE_RECHECK_MS + 10);
  });
}

beforeEach(() => {
  localStorage.clear();
  push.mockReset();
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(organizationsService, "getAll").mockResolvedValue([] as never);
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MEMBERSHIP_REVOKED from the backend", () => {
  it("runs refresh once, and the rejected refresh clears the session and goes to /login", async () => {
    seedTokens();
    await mount();
    backendAnswers(401, REVOKED);
    const refresh = vi.spyOn(authService, "refreshToken").mockRejectedValue(
      Object.assign(new Error("rejected"), { response: { status: 401 } })
    );

    await act(async () => { await someApiCall(); });
    await settle();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("refresh-old");
    expect(localStorage.getItem("accessToken")).toBeNull();
    expect(localStorage.getItem("refreshToken")).toBeNull();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("many revoked responses at once still log out exactly once", async () => {
    seedTokens();
    await mount();
    backendAnswers(401, REVOKED);
    const refresh = vi.spyOn(authService, "refreshToken").mockRejectedValue(
      Object.assign(new Error("rejected"), { response: { status: 401 } })
    );

    await act(async () => {
      await Promise.all([someApiCall(), someApiCall(), someApiCall(), someApiCall()]);
    });
    await settle();
    // Responses that arrive after logout must not start another run.
    await act(async () => { await someApiCall(); });
    await settle();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("other 401s and 403s do not trigger it", async () => {
    seedTokens();
    await mount();
    const refresh = vi.spyOn(authService, "refreshToken");

    backendAnswers(401, { success: false, error: "Token has expired", code: "TOKEN_EXPIRED" });
    await act(async () => { await someApiCall(); });
    backendAnswers(401, { success: false, error: "Invalid authentication token" });
    await act(async () => { await someApiCall(); });
    backendAnswers(403, { success: false, error: "Insufficient permissions", code: "MEMBERSHIP_REVOKED" });
    await act(async () => { await someApiCall(); });
    await settle();

    expect(refresh).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(localStorage.getItem("accessToken")).toBe("access-old");
  });

  it("a demoted user's 403 never logs them out", async () => {
    seedTokens();
    await mount();
    backendAnswers(403, { success: false, error: "Insufficient permissions", required: ["owner", "admin"], current: "viewer" });

    await act(async () => { await someApiCall(); });
    await settle();

    expect(push).not.toHaveBeenCalled();
    expect(localStorage.getItem("accessToken")).toBe("access-old");
  });

  it("once signed out, a revoked response does nothing", async () => {
    await mount();
    backendAnswers(401, REVOKED);
    const refresh = vi.spyOn(authService, "refreshToken");

    await act(async () => { await someApiCall(); });
    await settle();

    expect(refresh).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
