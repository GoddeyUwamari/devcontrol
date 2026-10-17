/**
 * Team members and invitations: rejected requests log the logError line
 * only -- not the invitee's email or the Authorization header.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MembersTab } from "../members-tab";
import { InviteMemberModal } from "@/components/modals/invite-member-modal";
import {
  expectNoSentinelInConsole,
  rejectEveryApiRequest,
  spyOnConsole,
} from "@/lib/__tests__/support/console-sentinels";

vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const INVITEE = "sentinel-invitee-8a1e@example.test";
const REJECTED = "Request failed with status code 403 (status 403, code FORBIDDEN)";

let restoreApi: () => void;
let spies: ReturnType<typeof spyOnConsole>;

beforeEach(() => {
  restoreApi = rejectEveryApiRequest(403, { success: false, error: "Not allowed", code: "FORBIDDEN" });
  spies = spyOnConsole();
});

afterEach(() => {
  restoreApi();
  vi.restoreAllMocks();
});

describe("members flows log no credentials", () => {
  it("members list fails to load", async () => {
    render(<MembersTab organization={{ id: "org-1" } as never} />);

    await waitFor(() =>
      expect(vi.mocked(console.error).mock.calls).toContainEqual([`Failed to fetch members: ${REJECTED}`]),
    );
    expectNoSentinelInConsole(spies);
  });

  it("invitation is rejected", async () => {
    render(<InviteMemberModal open onOpenChange={() => {}} organizationId="org-1" />);
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: INVITEE } });
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    await waitFor(() =>
      expect(vi.mocked(console.error).mock.calls).toContainEqual([`Failed to invite member: ${REJECTED}`]),
    );
    expectNoSentinelInConsole(spies, [INVITEE]);
  });
});
