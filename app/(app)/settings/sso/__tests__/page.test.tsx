/**
 * SSO settings: requests authenticate with the access token held by
 * tokenManager (the one every sign-in path stores), not a separate key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SSOSettingsPage from "../page";
import { tokenManager } from "@/lib/services/auth.service";

const mockUseAuth = vi.fn();
vi.mock("@/lib/contexts/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

let fetchMock: ReturnType<typeof vi.fn>;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SSOSettingsPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  mockUseAuth.mockReturnValue({ organization: { id: "org-1", subscriptionTier: "enterprise" } });
  fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ success: true, data: null }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SSO settings authentication", () => {
  it("sends the tokenManager access token", async () => {
    tokenManager.setAccessToken("canonical-access");
    const getAccessToken = vi.spyOn(tokenManager, "getAccessToken");

    renderPage();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(getAccessToken).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/auth\/saml\/config$/);
    expect(init.headers.Authorization).toBe("Bearer canonical-access");
  });

  it("ignores the obsolete auth-token key", async () => {
    localStorage.setItem("auth-token", "obsolete-token");

    renderPage();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });
});
