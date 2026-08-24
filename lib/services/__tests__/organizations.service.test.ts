import { describe, it, expect, vi, beforeEach } from "vitest";
import { organizationsService } from "../organizations.service";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    post: vi.fn(),
  },
}));

const mockedPost = vi.mocked(api.post);

function fakeResponse<T>(data: T) {
  return { data } as unknown as Awaited<ReturnType<typeof api.post>>;
}

describe("organizationsService.acceptInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls POST /api/organizations/accept-invitation with { invitationToken }", async () => {
    mockedPost.mockResolvedValue(
      fakeResponse({ success: true, data: { organizationId: "org-1", role: "member" } })
    );

    await organizationsService.acceptInvitation("token-abc");

    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(
      "/api/organizations/accept-invitation",
      { invitationToken: "token-abc" }
    );
  });

  it("returns response.data.data", async () => {
    const expected = { organizationId: "org-42", role: "admin" };
    mockedPost.mockResolvedValue(fakeResponse({ success: true, data: expected }));

    const result = await organizationsService.acceptInvitation("token-xyz");

    expect(result).toEqual(expected);
  });

  it("propagates API errors without swallowing them", async () => {
    const apiError = {
      response: {
        status: 400,
        data: { success: false, error: "Invalid or expired invitation" },
      },
    };
    mockedPost.mockRejectedValue(apiError);

    await expect(
      organizationsService.acceptInvitation("bad-token")
    ).rejects.toBe(apiError);
  });

  it("does not construct a URL from organizationId/inviteId", async () => {
    mockedPost.mockResolvedValue(
      fakeResponse({ success: true, data: { organizationId: "org-1", role: "member" } })
    );

    await organizationsService.acceptInvitation("token-abc");

    const [url] = mockedPost.mock.calls[0];
    expect(url).toBe("/api/organizations/accept-invitation");
    expect(url).not.toMatch(/\/invitations\//);
  });
});
