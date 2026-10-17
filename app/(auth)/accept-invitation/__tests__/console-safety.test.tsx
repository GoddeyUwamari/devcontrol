/**
 * Accept invitation: a rejected acceptance shows the same error state and
 * logs the logError line only -- not the invitation token or the
 * Authorization header.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AcceptInvitationPage from "../page";
import {
  SENTINEL_TOKEN,
  expectNoSentinelInConsole,
  rejectEveryApiRequest,
  spyOnConsole,
} from "@/lib/__tests__/support/console-sentinels";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams({ token: SENTINEL_TOKEN }),
}));

vi.mock("@/lib/contexts/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    isAuthenticated: true,
    isLoading: false,
    refreshOrganizations: async () => {},
  }),
}));

let restoreApi: () => void;
let spies: ReturnType<typeof spyOnConsole>;

beforeEach(() => {
  restoreApi = rejectEveryApiRequest(410, { success: false, error: "Invitation expired", code: "INVITATION_EXPIRED" });
  spies = spyOnConsole();
});

afterEach(() => {
  restoreApi();
  vi.restoreAllMocks();
});

describe("accept invitation logs no credentials", () => {
  it("rejected acceptance", async () => {
    render(<AcceptInvitationPage />);
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    expect(await screen.findByText("Invitation expired")).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(console.error).mock.calls).toEqual([
        ["Accept invitation error: Request failed with status code 410 (status 410, code INVITATION_EXPIRED)"],
      ]),
    );
    expectNoSentinelInConsole(spies);
  });
});
